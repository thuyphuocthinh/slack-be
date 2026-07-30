import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ORCHESTRATION_CONSTANTS, ORCHESTRATION_ERROR } from '@slack/constants';
import { AGENT_REGISTRY } from '../registry/agents.registry';
import {
  CallToolRequestDto,
  CallToolResponseDto,
  McpToolDto,
  McpResourceDto,
  McpPromptDto,
} from '../dto/mcp.dto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { withTimeout } from '../llm/with-timeout.util';
import { abortableSleep } from '../common/abortable-sleep.util';
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import { ProviderConcurrencyLimiterService } from '../common/provider-concurrency-limiter.service';
import { DynamicToolRegistryService } from '../registry/dynamic-tool-registry.service';
import { DynamicToolExecutorService } from '../executor/dynamic-tool-executor.service';
import { PiiScrubberUtil } from '../executor/pii-scrubber.util';

interface CacheEntry<T> {
  data: T[];
  fetchedAt: number;
}

interface ClientCacheEntry {
  promise: Promise<Client>;
  lastUsedAt: number;
}

// Ghi chú thiết kế đầy đủ (WHY): slack-docs/Documents/Orchestration/code-notes/mcp-client.service.md
@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);
  private readonly clients = new Map<string, ClientCacheEntry>();
  private readonly toolsCache = new Map<string, CacheEntry<McpToolDto>>();
  private readonly resourcesCache = new Map<
    string,
    CacheEntry<McpResourceDto>
  >();
  private readonly promptsCache = new Map<string, CacheEntry<McpPromptDto>>();
  private readonly inFlightLists = new Map<string, Promise<any>>();

  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly concurrencyLimiter: ProviderConcurrencyLimiterService,
    private readonly dynamicRegistry: DynamicToolRegistryService,
    private readonly dynamicExecutor: DynamicToolExecutorService,
  ) {}

  private async getClient(provider: string, ownerId?: string): Promise<Client> {
    const cacheKey = `${provider}:${ownerId ?? '__anon__'}`;
    const cached = this.clients.get(cacheKey);
    if (cached) {
      cached.lastUsedAt = Date.now();
      return cached.promise;
    }

    const connecting = this.connectClient(provider, ownerId);
    const entry: ClientCacheEntry = {
      promise: connecting,
      lastUsedAt: Date.now(),
    };
    this.clients.set(cacheKey, entry);
    connecting.catch(() => {
      if (this.clients.get(cacheKey) === entry) this.clients.delete(cacheKey);
    });
    return connecting;
  }

  private async connectClient(
    provider: string,
    ownerId?: string,
  ): Promise<Client> {
    const entry = AGENT_REGISTRY[provider];
    if (!entry?.endpoint) {
      throw new RpcException(ORCHESTRATION_ERROR.AGENT_NOT_REGISTERED);
    }

    const headers: Record<string, string> = {
      'X-Internal-Api-Key': process.env.MCP_SERVER_INTERNAL_API_KEY ?? '',
    };
    if (ownerId) headers['X-Owner-Id'] = ownerId;

    const client = new Client({ name: 'orchestration', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL(entry.endpoint),
      {
        requestInit: { headers },
      },
    );
    await withTimeout(
      client.connect(transport),
      ORCHESTRATION_CONSTANTS.MCP_CALL_TIMEOUT_MS,
      `MCP connect() timeout sau ${ORCHESTRATION_CONSTANTS.MCP_CALL_TIMEOUT_MS / 1000}s (provider=${provider})`,
    );

    this.logger.log(
      `Connected MCP client for provider "${provider}" at ${entry.endpoint}`,
    );
    return client;
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'evict-idle-mcp-clients' })
  async evictIdleClients(): Promise<void> {
    const now = Date.now();
    const idleEntries = Array.from(this.clients.entries()).filter(
      ([, entry]) =>
        now - entry.lastUsedAt > ORCHESTRATION_CONSTANTS.MCP_CLIENT_IDLE_TTL_MS,
    );
    if (idleEntries.length === 0) return;

    this.logger.log(
      `evictIdleClients() closing ${idleEntries.length} idle client(s)`,
    );
    await Promise.all(
      idleEntries.map(async ([cacheKey, entry]) => {
        this.clients.delete(cacheKey);
        try {
          const client = await entry.promise;
          await client.close();
        } catch (error) {
          this.logger.warn(
            `evictIdleClients() failed to close "${cacheKey}": ${(error as Error).message}`,
          );
        }
      }),
    );
  }

  @Cron(CronExpression.EVERY_10_MINUTES, {
    name: 'evict-stale-resource-cache',
  })
  evictStaleResourceCache(): void {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.resourceContentCache.entries()) {
      if (
        now - entry.fetchedAt >
        ORCHESTRATION_CONSTANTS.MCP_RESOURCE_CONTENT_CACHE_TTL_MS
      ) {
        this.resourceContentCache.delete(key);
        evicted++;
      }
    }
    if (evicted > 0) {
      this.logger.log(
        `evictStaleResourceCache() removed ${evicted} expired resource cache entry(s)`,
      );
    }
  }

  private async getCachedList<T>(
    provider: string,
    cacheMap: Map<string, CacheEntry<T>>,
    fetchFn: (client: Client) => Promise<T[]>,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const cached = cacheMap.get(provider);
    if (
      cached &&
      Date.now() - cached.fetchedAt <
        ORCHESTRATION_CONSTANTS.MCP_TOOLS_CACHE_TTL_MS
    ) {
      return cached.data;
    }

    let cacheType = 'tools';
    if (cacheMap === this.resourcesCache) cacheType = 'resources';
    if (cacheMap === this.promptsCache) cacheType = 'prompts';
    const key = `${cacheType}:${provider}`;

    const existingPromise = this.inFlightLists.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    const fetchPromise = (async () => {
      try {
        const data = await this.withReconnect(
          provider,
          undefined,
          fetchFn,
          3,
          signal,
        );
        cacheMap.set(provider, { data, fetchedAt: Date.now() });
        return data;
      } finally {
        this.inFlightLists.delete(key);
      }
    })();

    this.inFlightLists.set(key, fetchPromise);
    return fetchPromise;
  }

  async getTools(
    provider: string,
    query?: string,
    signal?: AbortSignal,
  ): Promise<McpToolDto[]> {
    if (await this.dynamicRegistry.isDynamicProvider(provider)) {
      return this.dynamicRegistry.getTools(provider, query);
    }

    return this.getCachedList(
      provider,
      this.toolsCache,
      async (client) => {
        const result = await client
          .listTools(undefined, { signal })
          .catch((e) => {
            if (!this.isMethodNotSupported(e)) throw e;
            this.logger.warn(
              `listTools not supported for ${provider}: ${e.message}`,
            );
            return { tools: [] };
          });
        return (result.tools || []) as McpToolDto[];
      },
      signal,
    );
  }

  async getResources(
    provider: string,
    signal?: AbortSignal,
  ): Promise<McpResourceDto[]> {
    if (await this.dynamicRegistry.isDynamicProvider(provider)) return [];

    return this.getCachedList(
      provider,
      this.resourcesCache,
      async (client) => {
        const result = await client
          .listResources(undefined, { signal })
          .catch((e) => {
            if (!this.isMethodNotSupported(e)) throw e;
            this.logger.warn(
              `listResources not supported for ${provider}: ${e.message}`,
            );
            return { resources: [] };
          });
        return (result.resources || []) as McpResourceDto[];
      },
      signal,
    );
  }

  async getPrompts(
    provider: string,
    signal?: AbortSignal,
  ): Promise<McpPromptDto[]> {
    if (await this.dynamicRegistry.isDynamicProvider(provider)) return [];

    return this.getCachedList(
      provider,
      this.promptsCache,
      async (client) => {
        const result = await client
          .listPrompts(undefined, { signal })
          .catch((e) => {
            if (!this.isMethodNotSupported(e)) throw e;
            this.logger.warn(
              `listPrompts not supported for ${provider}: ${e.message}`,
            );
            return { prompts: [] };
          });
        return (result.prompts || []) as McpPromptDto[];
      },
      signal,
    );
  }

  private isMethodNotSupported(error: unknown): boolean {
    return error instanceof McpError && error.code === ErrorCode.MethodNotFound;
  }

  private isStaleSessionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('Session not found') ||
      message.includes('Server not initialized')
    );
  }

  async callTool(
    dto: CallToolRequestDto,
    signal?: AbortSignal,
  ): Promise<CallToolResponseDto> {
    if (await this.dynamicRegistry.isDynamicProvider(dto.provider)) {
      return this.dynamicExecutor.execute(
        dto.provider,
        dto.name,
        dto.args,
        dto.ownerId,
        signal,
      );
    }

    const cachedTool = this.toolsCache
      .get(dto.provider)
      ?.data.find((t) => t.name === dto.name);
    const isDestructive = cachedTool
      ? Boolean(cachedTool.annotations?.destructiveHint)
      : true;
    const maxRetries = isDestructive ? 1 : 3;

    return this.withReconnect(
      dto.provider,
      dto.ownerId,
      async (client) => {
        const result = (await client.callTool(
          { name: dto.name, arguments: dto.args },
          undefined,
          { signal },
        )) as CallToolResponseDto;
        return this.scrubToolResult(result);
      },
      maxRetries,
      signal,
    );
  }

  private scrubToolResult(result: CallToolResponseDto): CallToolResponseDto {
    if (!result.content || !Array.isArray(result.content)) return result;
    return {
      ...result,
      content: result.content.map((item) => {
        if (item.type !== 'text' || typeof item.text !== 'string') return item;
        return {
          ...item,
          text: PiiScrubberUtil.scrub(item.text) as string,
        };
      }),
    };
  }

  private readonly resourceContentCache = new Map<
    string,
    { data: string; fetchedAt: number }
  >();

  async readResource(
    provider: string,
    uri: string,
    ownerId?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const cacheKey = `${provider}:${ownerId ?? '__anon__'}:${uri}`;
    const cached = this.resourceContentCache.get(cacheKey);
    if (
      cached &&
      Date.now() - cached.fetchedAt <
        ORCHESTRATION_CONSTANTS.MCP_RESOURCE_CONTENT_CACHE_TTL_MS
    ) {
      return cached.data;
    }

    const content = await this.withReconnect(
      provider,
      ownerId,
      async (client) => {
        const result = await client.readResource({ uri });
        return (result.contents || [])
          .map((c) => ('text' in c ? c.text : ''))
          .filter(Boolean)
          .join('\n');
      },
      3,
      signal,
    );

    this.resourceContentCache.set(cacheKey, {
      data: content,
      fetchedAt: Date.now(),
    });
    return content;
  }

  async getPrompt(
    provider: string,
    name: string,
    args: Record<string, string>,
    ownerId?: string,
  ) {
    return this.withReconnect(provider, ownerId, async (client) => {
      const result = await client.getPrompt({ name, arguments: args });
      return result;
    });
  }

  private async withReconnect<T>(
    provider: string,
    ownerId: string | undefined,
    fn: (client: Client) => Promise<T>,
    maxRetries = 3,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.circuitBreaker.run(`mcp:${provider}`, () =>
      this.concurrencyLimiter.run(
        `mcp:${provider}`,
        ORCHESTRATION_CONSTANTS.MAX_CONCURRENT_MCP_CALLS_PER_PROVIDER,
        () => this.callWithReconnect(provider, ownerId, fn, maxRetries, signal),
        signal,
      ),
    );
  }

  private async callWithReconnect<T>(
    provider: string,
    ownerId: string | undefined,
    fn: (client: Client) => Promise<T>,
    maxRetries: number,
    signal?: AbortSignal,
  ): Promise<T> {
    const cacheKey = `${provider}:${ownerId ?? '__anon__'}`;
    const timeoutMsg = `MCP call timeout sau ${ORCHESTRATION_CONSTANTS.MCP_CALL_TIMEOUT_MS / 1000}s (${cacheKey})`;

    let attempt = 0;
    let staleSessionBonusUsed = false;

    while (true) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      try {
        const client = await this.getClient(provider, ownerId);
        return await withTimeout(
          fn(client),
          ORCHESTRATION_CONSTANTS.MCP_CALL_TIMEOUT_MS,
          timeoutMsg,
        );
      } catch (error: any) {
        attempt++;

        if (signal?.aborted) {
          throw error;
        }

        this.logger.warn(
          `MCP call failed for "${cacheKey}", attempt ${attempt}/${maxRetries}: ${error.message}`,
        );
        this.clients.delete(cacheKey);

        const withinNormalBudget = attempt < maxRetries;
        const useStaleSessionBonus =
          !withinNormalBudget &&
          !staleSessionBonusUsed &&
          this.isStaleSessionError(error);

        if (!withinNormalBudget && !useStaleSessionBonus) {
          throw error;
        }
        if (useStaleSessionBonus) {
          staleSessionBonusUsed = true;
          this.logger.warn(
            `MCP call for "${cacheKey}" hit stale-session error — dùng thêm bonus retry (an toàn vì request thật chưa từng chạy)`,
          );
        }

        const delay = 500 * Math.pow(3, attempt - 1);
        await abortableSleep(delay, signal);
      }
    }
  }
}
