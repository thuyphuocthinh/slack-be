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
  private readonly inFlightLists = new Map<string, Promise<any>>();

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
    const entry: ClientCacheEntry = {
      promise: connecting,
      lastUsedAt: Date.now(),
    };
    this.clients.set(cacheKey, entry);
    // Không cache 1 lần connect lỗi vĩnh viễn — xoá để lần gọi sau retry được
    // (chỉ xoá nếu đây vẫn đúng entry của lần connect vừa lỗi, tránh đè lên 1
    // entry mới hơn đã thay thế nó).
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

  // Bug fix (Memory Leak #3) — resourceContentCache key bao gồm uri, nên
  // số entry tăng vô hạn theo từng URI mới bất kỳ user nào từng đọc (mỗi
  // trang Notion/Doc khác nhau = 1 entry mới). TTL chỉ quyết định khi nào
  // REFRESH (ghi đè), không tự xóa entry cũ. Cron sweep xóa các entry đã
  // hết TTL (không còn ai dùng trong thời gian gần) — giữ các entry mới
  // (còn trong TTL) để tiếp tục phuc vụ cache hit.
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

  // Lỗi "session chết" bên mcp_server (restart làm mất session trong RAM —
  // xem streamable_http_standard/index.ts) — server trả về NGAY tại tầng
  // transport/handshake, TRƯỚC KHI request thật (VD ghi SQL) từng chạy tới tool
  // handler, nên đây là trường hợp DUY NHẤT biết chắc CHƯA thực thi, an toàn để
  // cấp thêm 1 lần retry ngay cả với tool destructive (xem callWithReconnect()).
  // PHẢI check theo TEXT message, không theo `error.code`: server dùng lại 2
  // mã số -32000/-32001 với Ý NGHĨA KHÁC hẳn enum ErrorCode phía client SDK
  // (-32000 = ConnectionClosed, -32001 = RequestTimeout) — so theo code sẽ
  // nhầm lẫn với 2 loại lỗi đó. Giữ cả 2 message (kể cả "Server not
  // initialized" cũ) để không phụ thuộc đúng thời điểm deploy giữa 2 repo.
  private isStaleSessionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('Session not found') ||
      message.includes('Server not initialized')
    );
  }

  // `signal` (Stop giữa turn, xem ReactLoopService.run()/runCancellable()) huỷ
  // được cả 2 nhánh — static qua SDK MCP (RequestOptions.signal) và dynamic
  // provider qua agentic-openapi-parser@1.8.0+ (ExecuteToolOptions.signal,
  // forward thẳng vào axios + bỏ qua retry sau khi huỷ).
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

    // Tool KHÔNG idempotent (destructiveHint) không được tự động retry —
    // timeout/lỗi mạng SAU KHI tool đã thực thi thật ở server (chỉ là response
    // bị mất/chậm) không đồng nghĩa với "chưa chạy". Retry mù ở đây có thể ghi
    // trùng (INSERT trùng dòng, gửi email trùng, append trùng nội dung) — đặc
    // biệt nguy hiểm với hành động ĐÃ qua HITL approval (executeApprovedToolForReal),
    // nơi user chỉ duyệt cho ĐÚNG 1 lần thực thi. Tool đọc (an toàn, không
    // side-effect) vẫn giữ retry để chịu được mất kết nối/session thoáng qua.
    // Đọc THẲNG cache nội bộ (không gọi getTools() công khai) — tránh ép fetch
    // mới/tạo thêm 1 connection riêng chỉ để tra cứu; nếu chưa có cache sẵn
    // (VD ReactLoop luôn getTools() trước khi callTool() nên thường đã có),
    // mặc định coi như KHÔNG chắc chắn an toàn, không retry.
    const cachedTools = this.toolsCache.get(dto.provider)?.data;
    const isDestructive = cachedTools
      ? Boolean(
          cachedTools.find((t) => t.name === dto.name)?.annotations
            ?.destructiveHint,
        )
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

  // Bug fix (PII #2) — static provider (SQL Server, Gmail, Sheets, Docs, Drive,
  // Calendar, Slack, Notion, GitHub) đi qua đây, KHÔNG qua DynamicToolExecutorService
  // — nếu không scrub riêng, toàn bộ email content/SQL rows/Notion pages sẽ
  // được feed vào LLM context không qua bất kỳ PII filter nào. Mirror đúng
  // cách dynamic path dùng PiiScrubProcessor trong executor pipeline.
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

  // accuracy_problem.md mục 9.4 — TRƯỚC ĐÂY đọc lại NỘI DUNG resource từ MCP
  // server mỗi lần ReactLoopService.run() dựng systemInstruction, kể cả khi
  // CÙNG 1 provider được delegate nhiều lần trong CÙNG 1 kế hoạch (VD đọc rồi
  // ghi SQL) — lãng phí network/latency vô ích vì nội dung này thường tĩnh.
  // Cache riêng theo (provider, ownerId, uri) — BẮT BUỘC có ownerId trong key:
  // connectClient() gắn header X-Owner-Id RIÊNG cho từng user (xem trên) nên
  // NỘI DUNG trả về cho CÙNG 1 uri được PHÉP khác nhau theo từng user (VD
  // Notion/Google Docs — mỗi user 1 workspace/token riêng dù danh sách URI
  // dùng chung 1 tên). Bỏ sót ownerId (bug thật đã tự gây ra ở lần thêm cache
  // này) sẽ khiến User B trong cùng cửa sổ TTL nhận nhầm NGUYÊN VĂN nội dung
  // của User A.
  // Bug fix: vì key bao gồm uri (không chỉ provider×ownerId), Map tăng vô hạn
  // theo từng URI mới bất kỳ user nào từng đọc — evictStaleResourceCache() cron
  // (mỗi 10 phút) dọn các entry đã hết TTL để giới hạn memory footprint.
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

  /**
   * Client cache sống lâu hơn 1 lần deploy của mcp_server — nếu mcp_server
   * restart (session trong RAM mất sạch) mà client vẫn cầm session cũ, request
   * sẽ lỗi ("Server not initialized"/"Server already initialized"...). Gặp lỗi
   * là bỏ luôn client cũ, tạo kết nối mới rồi thử lại (mặc định tối đa 3 lần —
   * `maxRetries=1` cho tool không idempotent, xem callTool()).
   */
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
    // Ngân sách retry "bonus" riêng cho lỗi session-chết (xem isStaleSessionError())
    // — CHỈ dùng được đúng 1 LẦN mỗi call, kể cả khi maxRetries thường (VD tool
    // destructive) đã hết, vì đây là loại lỗi DUY NHẤT biết chắc chưa thực thi.
    let staleSessionBonusUsed = false;

    while (true) {
      // Stop vừa xảy ra trong lúc đang đợi backoff ở vòng lặp trước — dừng
      // NGAY, đừng cố thêm 1 round-trip mạng vô ích nữa.
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

        // Bị huỷ giữa chừng (Stop) — đây KHÔNG phải lỗi tạm thời đáng thử lại,
        // ném thẳng lên để runCancellable() nhận diện đúng là turn bị huỷ,
        // không lãng phí thêm 1 vòng backoff+retry vô nghĩa.
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

        // Exponential backoff: 500ms, 1500ms... — abortable để Stop trong lúc
        // đang chờ giữa 2 lần retry cũng có tác dụng ngay, không phải đợi hết delay.
        const delay = 500 * Math.pow(3, attempt - 1);
        await abortableSleep(delay, signal);
      }
    }
  }
}
