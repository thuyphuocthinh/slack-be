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
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import { ProviderConcurrencyLimiterService } from '../common/provider-concurrency-limiter.service';
import { DynamicToolRegistryService } from '../registry/dynamic-tool-registry.service';
import { DynamicToolExecutorService } from '../executor/dynamic-tool-executor.service';

interface CacheEntry<T> {
  data: T[];
  fetchedAt: number;
}

interface ClientCacheEntry {
  // Giai đoạn System, mục 5.1 — cache PROMISE đang connect (không phải Client
  // đã resolve), để 2 request cùng cacheKey đến gần như đồng thời AWAIT
  // CHUNG 1 lần connect thay vì mỗi request tự tạo 1 connection riêng (client
  // connect trước bị mồ côi, không đóng, rò rỉ session).
  promise: Promise<Client>;
  lastUsedAt: number;
}

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

  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly concurrencyLimiter: ProviderConcurrencyLimiterService,
    private readonly dynamicRegistry: DynamicToolRegistryService,
    private readonly dynamicExecutor: DynamicToolExecutorService,
  ) {}

  // Header là static per-transport (SDK không hỗ trợ header per-call) — nên
  // cache 1 client riêng cho mỗi (provider, ownerId) khi cần gọi tool thật;
  // client dùng để chỉ listTools() (không cần owner) cache riêng theo provider.
  private async getClient(provider: string, ownerId?: string): Promise<Client> {
    const cacheKey = `${provider}:${ownerId ?? '__anon__'}`;
    const cached = this.clients.get(cacheKey);
    if (cached) {
      cached.lastUsedAt = Date.now();
      return cached.promise;
    }

    const connecting = this.connectClient(provider, ownerId);
    const entry: ClientCacheEntry = { promise: connecting, lastUsedAt: Date.now() };
    this.clients.set(cacheKey, entry);
    // Không cache 1 lần connect lỗi vĩnh viễn — xoá để lần gọi sau retry được
    // (chỉ xoá nếu đây vẫn đúng entry của lần connect vừa lỗi, tránh đè lên 1
    // entry mới hơn đã thay thế nó).
    connecting.catch(() => {
      if (this.clients.get(cacheKey) === entry) this.clients.delete(cacheKey);
    });
    return connecting;
  }

  private async connectClient(provider: string, ownerId?: string): Promise<Client> {
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

  // Giai đoạn System, mục 5.3 — client không được dùng quá MCP_CLIENT_IDLE_TTL_MS
  // thì đóng + xoá khỏi cache, tránh giữ socket/session mở vô thời hạn khi có
  // nhiều user riêng biệt qua suốt vòng đời process (khác toolsCache/
  // resourcesCache/promptsCache — key theo provider nên số lượng đã bounded).
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'evict-idle-mcp-clients' })
  async evictIdleClients(): Promise<void> {
    const now = Date.now();
    const idleEntries = Array.from(this.clients.entries()).filter(
      ([, entry]) =>
        now - entry.lastUsedAt > ORCHESTRATION_CONSTANTS.MCP_CLIENT_IDLE_TTL_MS,
    );
    if (idleEntries.length === 0) return;

    this.logger.log(`evictIdleClients() closing ${idleEntries.length} idle client(s)`);
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
        if (!this.isMethodNotSupported(e)) throw e;
        this.logger.warn(`listTools not supported for ${provider}: ${e.message}`);
        return { tools: [] };
      });
      return (result.tools || []) as McpToolDto[];
    });
  }

  async getResources(provider: string): Promise<McpResourceDto[]> {
    if (await this.dynamicRegistry.isDynamicProvider(provider)) return [];

    return this.getCachedList(provider, this.resourcesCache, async (client) => {
      const result = await client.listResources().catch((e) => {
        if (!this.isMethodNotSupported(e)) throw e;
        this.logger.warn(`listResources not supported for ${provider}: ${e.message}`);
        return { resources: [] };
      });
      return (result.resources || []) as McpResourceDto[];
    });
  }

  async getPrompts(provider: string): Promise<McpPromptDto[]> {
    if (await this.dynamicRegistry.isDynamicProvider(provider)) return [];

    return this.getCachedList(provider, this.promptsCache, async (client) => {
      const result = await client.listPrompts().catch((e) => {
        if (!this.isMethodNotSupported(e)) throw e;
        this.logger.warn(`listPrompts not supported for ${provider}: ${e.message}`);
        return { prompts: [] };
      });
      return (result.prompts || []) as McpPromptDto[];
    });
  }

  // Giai đoạn 4 (bug "restart mcp_server làm mất hết tool cho tới khi restart
  // orchestration") — TRƯỚC ĐÂY mọi lỗi từ listTools/listResources/listPrompts
  // đều bị nuốt thành "coi như thành công, trả rỗng" — kể cả lỗi kết nối/session
  // chết (VD mcp_server vừa restart, client vẫn cầm session cũ -> "Bad Request:
  // Server not initialized"). Vì lỗi không bao giờ bay lên tới
  // callWithReconnect(), cơ chế "xoá client cũ, reconnect, thử lại" ở đó KHÔNG
  // BAO GIỜ chạy — cái rỗng đó còn bị cache lại (MCP_TOOLS_CACHE_TTL_MS) làm
  // mọi request sau đó cũng thấy rỗng, cho tới khi restart orchestration (xoá
  // sạch cache trong RAM) mới hết.
  // CHỈ coi là "server không hỗ trợ tool/resource/prompt này" (an toàn để trả
  // rỗng, không cần reconnect) khi đúng là lỗi JSON-RPC "Method not found" —
  // MỌI lỗi khác (mất kết nối, session chết, timeout...) phải NÉM LẠI để
  // callWithReconnect() xử lý đúng vai trò của nó.
  private isMethodNotSupported(error: unknown): boolean {
    return error instanceof McpError && error.code === ErrorCode.MethodNotFound;
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
   *
   * Giai đoạn System, mục 5.2 — check circuit TRƯỚC (fail-fast, không tốn
   * slot) rồi mới qua concurrency limiter (cũng theo TỪNG PROVIDER) — giới
   * hạn số request THẬT được chạy đồng thời vào 1 provider, độc lập với
   * concurrency:5 (global) của BullMQ worker.
   */
  private async withReconnect<T>(
    provider: string,
    ownerId: string | undefined,
    fn: (client: Client) => Promise<T>,
  ): Promise<T> {
    return this.circuitBreaker.run(`mcp:${provider}`, () =>
      this.concurrencyLimiter.run(
        `mcp:${provider}`,
        ORCHESTRATION_CONSTANTS.MAX_CONCURRENT_MCP_CALLS_PER_PROVIDER,
        () => this.callWithReconnect(provider, ownerId, fn),
      ),
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
