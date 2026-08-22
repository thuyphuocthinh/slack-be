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
import { routeKey, clientCacheKey } from './route-key.util';
import { RelayClientTransport } from './relay-client.transport';
import { EdgeRelayRegistryService } from '../edge-relay/edge-relay-registry.service';
import { RelayOfflineError } from '../edge-relay/relay-offline.error';
import { RelayTimeoutError } from '../edge-relay/relay-timeout.error';

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
    private readonly edgeRelayRegistry: EdgeRelayRegistryService,
  ) {}

  private async getClient(
    provider: string,
    ownerId?: string,
    workspaceId?: string,
  ): Promise<Client> {
    const cacheKey = clientCacheKey(provider, ownerId, workspaceId);
    const cached = this.clients.get(cacheKey);
    if (cached) {
      cached.lastUsedAt = Date.now();
      return cached.promise;
    }

    const connecting = this.connectClient(provider, ownerId, workspaceId);
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
    workspaceId?: string,
  ): Promise<Client> {
    const entry = AGENT_REGISTRY[provider];

    if (entry?.perWorkspaceInstance) {
      if (!workspaceId) {
        throw new RpcException(ORCHESTRATION_ERROR.AGENT_NOT_REGISTERED);
      }
      const client = new Client({ name: 'orchestration', version: '1.0.0' });
      const transport = new RelayClientTransport(
        workspaceId,
        this.edgeRelayRegistry,
      );
      await withTimeout(
        client.connect(transport),
        ORCHESTRATION_CONSTANTS.MCP_CALL_TIMEOUT_MS,
        `MCP connect() timeout sau ${ORCHESTRATION_CONSTANTS.MCP_CALL_TIMEOUT_MS / 1000}s (provider=${provider})`,
      );
      this.logger.log(
        `Connected MCP client for provider "${routeKey(provider, workspaceId)}" via edge relay`,
      );
      return client;
    }

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
      `Connected MCP client for provider "${routeKey(provider, workspaceId)}" at ${entry.endpoint}`,
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
        // Re-check danh tính + độ mới ngay trước khi xoá, giống cách getClient() tự dọn
        // dẹp — tránh xoá nhầm 1 entry MỚI đã thay thế entry cũ tại cùng cacheKey.
        if (
          Date.now() - entry.lastUsedAt <=
          ORCHESTRATION_CONSTANTS.MCP_CLIENT_IDLE_TTL_MS
        ) {
          return;
        }
        if (this.clients.get(cacheKey) !== entry) return;

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
    workspaceId?: string,
  ): Promise<T[]> {
    const cacheKey = routeKey(provider, workspaceId);
    const cached = cacheMap.get(cacheKey);
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
    const key = `${cacheType}:${cacheKey}`;

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
          workspaceId,
        );
        cacheMap.set(cacheKey, { data, fetchedAt: Date.now() });
        return data;
      } finally {
        this.inFlightLists.delete(key);
      }
    })();

    this.inFlightLists.set(key, fetchPromise);
    return fetchPromise;
  }

  // callTool() dùng annotations của tool này để quyết định số lần retry an toàn
  // (isDestructive) — chỉ tin cache còn trong TTL, cache cũ có thể không còn khớp
  // với tool thật (VD provider vừa đổi 1 tool từ an toàn sang destructive).
  private getFreshCachedTool(
    provider: string,
    toolName: string,
    workspaceId?: string,
  ): McpToolDto | undefined {
    const key = routeKey(provider, workspaceId);
    const cached = this.toolsCache.get(key);
    this.logger.debug(
      `getFreshCachedTool key="${key}" tool="${toolName}" ` +
        `cacheHit=${!!cached} ` +
        `age=${cached ? Date.now() - cached.fetchedAt : 'N/A'}ms ` +
        `toolFound=${cached?.data?.some((t) => t.name === toolName) ?? false}`,
    );
    if (
      !cached ||
      Date.now() - cached.fetchedAt >=
        ORCHESTRATION_CONSTANTS.MCP_TOOLS_CACHE_TTL_MS
    ) {
      return undefined;
    }
    return cached.data.find((t) => t.name === toolName);
  }

  async getTools(
    provider: string,
    query?: string,
    signal?: AbortSignal,
    workspaceId?: string,
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
      workspaceId,
    );
  }

  async getResources(
    provider: string,
    signal?: AbortSignal,
    workspaceId?: string,
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
      workspaceId,
    );
  }

  async getPrompts(
    provider: string,
    signal?: AbortSignal,
    workspaceId?: string,
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
      workspaceId,
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

  // Phân biệt với lỗi kết nối/session (ETIMEDOUT, Session not found...): đây
  // là withTimeout() ở callWithReconnect() TỰ bỏ cuộc chờ, không phải MCP
  // server báo lỗi — connection vẫn có thể đang ổn, chỉ là query/data VỐN
  // chậm (đọc bảng lớn, Sheet/Doc dài...). Reconnect + gọi lại NGUYÊN VẸN
  // request đó vào ĐÚNG ngưỡng thời gian cũ chắc chắn timeout lần nữa — chỉ
  // nhân thêm thời gian chờ trước khi báo lỗi mà không tăng cơ hội thành công.
  private isTimeoutError(error: unknown, timeoutMsg: string): boolean {
    return error instanceof Error && error.message === timeoutMsg;
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

    let cachedTool = this.getFreshCachedTool(
      dto.provider,
      dto.name,
      dto.workspaceId,
    );
    const isPerWorkspace = !!AGENT_REGISTRY[dto.provider]?.perWorkspaceInstance;

    // Lớp chặn thứ 2, độc lập với quyền `db_datareader` phía SQL Server: relay
    // (perWorkspaceInstance) tự khai tool qua listTools() của chính nó — nếu
    // relay có bug/bị giả mạo khai nhầm 1 tool ghi thành an toàn, backend vẫn
    // không tin, chặn hẳn tại đây. Fail-closed: thiếu annotation (cache miss)
    // cũng bị coi là KHÔNG an toàn, không mặc định cho qua.
    //
    // Tuy nhiên cache miss CÓ THỂ do cache bị stale/cleared (race condition,
    // reconnect...) — chặn ngay khi miss gây false positive cho tool AN TOÀN
    // (readOnlyHint) giữa 1 vòng ReactLoop. Nên thử refresh 1 lần trước khi
    // quyết định chặn — nếu SAU refresh vẫn không thấy readOnlyHint → vẫn chặn.
    if (isPerWorkspace && !cachedTool?.annotations?.readOnlyHint) {
      if (!cachedTool) {
        // Cache miss — thử refresh trước khi chặn
        this.logger.warn(
          `Write gate cache miss for "${dto.name}" (${routeKey(dto.provider, dto.workspaceId)}) — refreshing tools before blocking`,
        );
        await this.getTools(dto.provider, undefined, signal, dto.workspaceId);
        const refreshed = this.getFreshCachedTool(
          dto.provider,
          dto.name,
          dto.workspaceId,
        );
        if (refreshed?.annotations?.readOnlyHint) {
          cachedTool = refreshed;
        } else {
          return this.toEdgeRelayErrorResponse(
            'RELAY_WRITE_BLOCKED',
            false,
            `Tool "${dto.name}" bị chặn — hệ thống on-prem qua Edge MCP Server chỉ được phép gọi tool ĐỌC (readOnlyHint), không xác nhận được tool này an toàn.`,
          );
        }
      } else {
        // Tool tồn tại trong cache nhưng KHÔNG có readOnlyHint → chặn ngay
        return this.toEdgeRelayErrorResponse(
          'RELAY_WRITE_BLOCKED',
          false,
          `Tool "${dto.name}" bị chặn — hệ thống on-prem qua Edge MCP Server chỉ được phép gọi tool ĐỌC (readOnlyHint), không xác nhận được tool này an toàn.`,
        );
      }
    }

    const isDestructive = cachedTool
      ? Boolean(cachedTool.annotations?.destructiveHint)
      : true;
    const maxRetries = isDestructive ? 1 : 3;

    try {
      return await this.withReconnect(
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
        dto.workspaceId,
      );
    } catch (error) {
      if (error instanceof RelayOfflineError) {
        return this.toEdgeRelayErrorResponse(
          'RELAY_OFFLINE',
          false,
          error.message,
        );
      }
      if (error instanceof RelayTimeoutError) {
        // Luôn retryable — gate phía trên đã chặn hết tool KHÔNG readOnlyHint
        // cho provider perWorkspaceInstance (nguồn duy nhất phát sinh lỗi
        // này), nên tới được đây nghĩa là tool đang gọi chắc chắn chỉ đọc.
        return this.toEdgeRelayErrorResponse(
          'RELAY_TIMEOUT',
          true,
          error.message,
        );
      }
      throw error;
    }
  }

  private toEdgeRelayErrorResponse(
    code: string,
    retryable: boolean,
    message: string,
  ): CallToolResponseDto {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: true, retryable, code, message }),
        },
      ],
    };
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
    workspaceId?: string,
  ): Promise<string> {
    const cacheKey = `${routeKey(provider, workspaceId)}:${ownerId ?? '__anon__'}:${uri}`;
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
      workspaceId,
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
    workspaceId?: string,
  ) {
    return this.withReconnect(
      provider,
      ownerId,
      async (client) => {
        const result = await client.getPrompt({ name, arguments: args });
        return result;
      },
      3,
      undefined,
      workspaceId,
    );
  }

  private async withReconnect<T>(
    provider: string,
    ownerId: string | undefined,
    fn: (client: Client) => Promise<T>,
    maxRetries = 3,
    signal?: AbortSignal,
    workspaceId?: string,
  ): Promise<T> {
    const failureDomainKey = `mcp:${routeKey(provider, workspaceId)}`;
    return this.circuitBreaker.run(
      failureDomainKey,
      () =>
        this.concurrencyLimiter.run(
          failureDomainKey,
          ORCHESTRATION_CONSTANTS.MAX_CONCURRENT_MCP_CALLS_PER_PROVIDER,
          () =>
            this.callWithReconnect(
              provider,
              ownerId,
              fn,
              maxRetries,
              signal,
              workspaceId,
            ),
          signal,
        ),
      signal,
    );
  }

  private async callWithReconnect<T>(
    provider: string,
    ownerId: string | undefined,
    fn: (client: Client) => Promise<T>,
    maxRetries: number,
    signal?: AbortSignal,
    workspaceId?: string,
  ): Promise<T> {
    const cacheKey = clientCacheKey(provider, ownerId, workspaceId);
    const timeoutMsg = `MCP call timeout sau ${ORCHESTRATION_CONSTANTS.MCP_CALL_TIMEOUT_MS / 1000}s (${cacheKey})`;

    let attempt = 0;
    let staleSessionBonusUsed = false;

    while (true) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      try {
        const client = await this.getClient(provider, ownerId, workspaceId);
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

        if (this.isTimeoutError(error, timeoutMsg)) {
          throw error;
        }

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
