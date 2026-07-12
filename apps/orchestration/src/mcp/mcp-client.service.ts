import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ORCHESTRATION_CONSTANTS, ORCHESTRATION_ERROR } from '@slack/constants';
import { AGENT_REGISTRY } from '../registry/agents.registry';
import {
  CallToolRequestDto,
  CallToolResponseDto,
  McpToolDto,
  McpResourceDto,
  McpPromptDto,
} from '../dto/mcp.dto';
import { withTimeout } from '../llm/with-timeout.util';
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import { DynamicToolRegistryService } from '../registry/dynamic-tool-registry.service';
import { DynamicToolExecutorService } from '../executor/dynamic-tool-executor.service';

interface CacheEntry<T> {
  data: T[];
  fetchedAt: number;
}

@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);
  private readonly clients = new Map<string, Client>();
  private readonly toolsCache = new Map<string, CacheEntry<McpToolDto>>();
  private readonly resourcesCache = new Map<
    string,
    CacheEntry<McpResourceDto>
  >();
  private readonly promptsCache = new Map<string, CacheEntry<McpPromptDto>>();

  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly dynamicRegistry: DynamicToolRegistryService,
    private readonly dynamicExecutor: DynamicToolExecutorService,
  ) {}

  // Header là static per-transport (SDK không hỗ trợ header per-call) — nên
  // cache 1 client riêng cho mỗi (provider, ownerId) khi cần gọi tool thật;
  // client dùng để chỉ listTools() (không cần owner) cache riêng theo provider.
  private async getClient(provider: string, ownerId?: string): Promise<Client> {
    const cacheKey = `${provider}:${ownerId ?? '__anon__'}`;
    const cached = this.clients.get(cacheKey);
    if (cached) return cached;

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

    this.clients.set(cacheKey, client);
    this.logger.log(
      `Connected MCP client for provider "${provider}" at ${entry.endpoint}`,
    );
    return client;
  }

  private async getCachedList<T>(
    provider: string,
    cacheMap: Map<string, CacheEntry<T>>,
    fetchFn: (client: Client) => Promise<T[]>,
  ): Promise<T[]> {
    const cached = cacheMap.get(provider);
    if (
      cached &&
      Date.now() - cached.fetchedAt <
        ORCHESTRATION_CONSTANTS.MCP_TOOLS_CACHE_TTL_MS
    ) {
      return cached.data;
    }

    const data = await this.withReconnect(provider, undefined, fetchFn);

    cacheMap.set(provider, { data, fetchedAt: Date.now() });
    return data;
  }

  async getTools(provider: string, query?: string): Promise<McpToolDto[]> {
    if (await this.dynamicRegistry.isDynamicProvider(provider)) {
      return this.dynamicRegistry.getTools(provider, query);
    }

    return this.getCachedList(provider, this.toolsCache, async (client) => {
      const result = await client.listTools().catch((e) => {
        this.logger.warn(
          `listTools failed or not supported for ${provider}: ${e.message}`,
        );
        return { tools: [] };
      });
      return (result.tools || []) as McpToolDto[];
    });
  }

  async getResources(provider: string): Promise<McpResourceDto[]> {
    if (await this.dynamicRegistry.isDynamicProvider(provider)) return [];

    return this.getCachedList(provider, this.resourcesCache, async (client) => {
      const result = await client.listResources().catch((e) => {
        this.logger.warn(
          `listResources failed or not supported for ${provider}: ${e.message}`,
        );
        return { resources: [] };
      });
      return (result.resources || []) as McpResourceDto[];
    });
  }

  async getPrompts(provider: string): Promise<McpPromptDto[]> {
    if (await this.dynamicRegistry.isDynamicProvider(provider)) return [];

    return this.getCachedList(provider, this.promptsCache, async (client) => {
      const result = await client.listPrompts().catch((e) => {
        this.logger.warn(
          `listPrompts failed or not supported for ${provider}: ${e.message}`,
        );
        return { prompts: [] };
      });
      return (result.prompts || []) as McpPromptDto[];
    });
  }

  async callTool(dto: CallToolRequestDto): Promise<CallToolResponseDto> {
    if (await this.dynamicRegistry.isDynamicProvider(dto.provider)) {
      return this.dynamicExecutor.execute(
        dto.provider,
        dto.name,
        dto.args,
        dto.ownerId,
      );
    }

    return this.withReconnect(
      dto.provider,
      dto.ownerId,
      (client) =>
        client.callTool({
          name: dto.name,
          arguments: dto.args,
        }) as Promise<CallToolResponseDto>,
    );
  }

  async readResource(
    provider: string,
    uri: string,
    ownerId?: string,
  ): Promise<string> {
    return this.withReconnect(provider, ownerId, async (client) => {
      const result = await client.readResource({ uri });
      return (result.contents || [])
        .map((c) => ('text' in c ? c.text : ''))
        .filter(Boolean)
        .join('\n');
    });
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

  /**
   * Giai đoạn 4, Step 6 — circuit breaker theo TỪNG PROVIDER (không theo
   * ownerId — 1 MCP server sập là lỗi hạ tầng, không phải lỗi riêng của 1
   * user). Khi mạch OPEN, request mới fail NGAY, không đợi hết
   * MCP_CALL_TIMEOUT_MS/thử reconnect như bình thường.
   */
  private async withReconnect<T>(
    provider: string,
    ownerId: string | undefined,
    fn: (client: Client) => Promise<T>,
  ): Promise<T> {
    return this.circuitBreaker.run(`mcp:${provider}`, () =>
      this.callWithReconnect(provider, ownerId, fn),
    );
  }

  /**
   * Client cache sống lâu hơn 1 lần deploy của mcp_server — nếu mcp_server
   * restart (session trong RAM mất sạch) mà client vẫn cầm session cũ, request
   * sẽ lỗi ("Server not initialized"/"Server already initialized"...). Gặp lỗi
   * là bỏ luôn client cũ, tạo kết nối mới rồi thử lại đúng 1 lần.
   */
  private async callWithReconnect<T>(
    provider: string,
    ownerId: string | undefined,
    fn: (client: Client) => Promise<T>,
  ): Promise<T> {
    const cacheKey = `${provider}:${ownerId ?? '__anon__'}`;
    const timeoutMsg = `MCP call timeout sau ${ORCHESTRATION_CONSTANTS.MCP_CALL_TIMEOUT_MS / 1000}s (${cacheKey})`;

    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const client = await this.getClient(provider, ownerId);
        return await withTimeout(
          fn(client),
          ORCHESTRATION_CONSTANTS.MCP_CALL_TIMEOUT_MS,
          timeoutMsg,
        );
      } catch (error: any) {
        attempt++;
        this.logger.warn(
          `MCP call failed for "${cacheKey}", attempt ${attempt}/${maxRetries}: ${error.message}`,
        );
        this.clients.delete(cacheKey);

        if (attempt >= maxRetries) {
          throw error;
        }

        // Exponential backoff: 500ms, 1500ms...
        const delay = 500 * Math.pow(3, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error('Unreachable');
  }
}
