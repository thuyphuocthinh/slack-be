import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { McpToolDto } from '../dto/mcp.dto';
import { OpenApiParserService } from '../parser/openapi-parser.service';
import { OpenApiConverter } from '../parser/openapi-converter.util';
import { DynamicProviderEntity } from '../entity/dynamic-provider.entity';
import { OpenAPI } from 'openapi-types';
import { RpcException } from '@nestjs/microservices';
import { ORCHESTRATION_ERROR } from '@slack/constants';
import { buildTTL } from '@slack/common';
import { EDynamicProviderAuthType } from '../entity/dynamic-provider.entity';
import { SemanticToolIndex } from '../common/agentic-openapi-parser';
import { OpenAiEmbeddingProvider } from './openai-embedding.provider';

// McpToolDto.description is optional (real MCP servers may omit it), but SemanticToolIndex
// requires a plain string — narrowed to '' when missing, only for ranking purposes.
interface IndexableMcpTool extends McpToolDto {
  description: string;
}

/** How many of the semantically-ranked tools to hand to the LLM — well under the 128 hard cap,
 *  small enough that a static-filter-only setup (0-100 tools) never even reaches this path. */
const SEMANTIC_SEARCH_TOP_K = 20;

export interface DynamicProviderSpec {
  providerId: string;
  specUrl: string;
  document: OpenAPI.Document;
  tools: McpToolDto[];

  /**
   * Lưu trữ API Key, Basic Auth credentials, hoặc OAuth2 Access Token tuỳ thuộc vào authType.
   */
  accessToken?: string;
  authType?: EDynamicProviderAuthType;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  authConfig?: any;
}

interface CacheEntry {
  data: DynamicProviderSpec;
  // Dùng để dọn RAM entry không ai đụng tới (cleanupExpiredCache) — KHÁC
  // loadedAt bên dưới, không dùng để quyết định có đọc lại DB hay không.
  lastAccessed: number;
  loadedAt: number;
  // Built lazily, only for providers with >128 tools — see getTools(). Replaced automatically
  // whenever ensureLoaded() reloads the entry (e.g. after cache TTL expiry), so it can never
  // serve stale rankings for a tool list that no longer matches.
  semanticIndex?: SemanticToolIndex<IndexableMcpTool>;
  // Mốc thời gian lần cuối DynamicToolExecutorService mutate token TRỰC TIẾP trong RAM
  // (reactive refresh sau 401) — xem markTokenRefreshed()/loadIntoCache().
  tokenMutatedAt?: number;
}

@Injectable()
export class DynamicToolRegistryService implements OnModuleDestroy {
  private readonly logger = new Logger(DynamicToolRegistryService.name);

  // Cache trên RAM kết hợp TTL (Thời gian sống)
  private readonly registry = new Map<string, CacheEntry>();

  // Tự động giải phóng RAM sau 1 giờ không có ai sử dụng
  private readonly CACHE_TTL_MS = buildTTL('HOUR', 1);
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly parserService: OpenApiParserService,
    @InjectRepository(DynamicProviderEntity)
    private readonly providerRepo: Repository<DynamicProviderEntity>,
    private readonly embeddingProvider: OpenAiEmbeddingProvider,
  ) {
    // Định kỳ 30 phút quét 1 lần để dọn rác RAM
    this.cleanupInterval = setInterval(
      () => this.cleanupExpiredCache(),
      buildTTL('MINUTE', 30),
    );
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
  }

  private cleanupExpiredCache() {
    const now = Date.now();
    let deletedCount = 0;

    for (const [key, entry] of this.registry.entries()) {
      if (now - entry.lastAccessed > this.CACHE_TTL_MS) {
        this.registry.delete(key);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      this.logger.log(
        `Cleaned up ${deletedCount} unused dynamic providers from RAM to free memory.`,
      );
    }
  }

  /**
   * Đảm bảo provider đã được load từ DB và parse thành công vào RAM, đọc lại
   * DB nếu entry đã quá hạn (isStale) — kể cả khi vẫn đang được dùng liên tục.
   */
  private async ensureLoaded(providerId: string): Promise<void> {
    const existing = this.registry.get(providerId);
    if (existing && !this.isStale(existing)) {
      existing.lastAccessed = Date.now();
      return;
    }

    await this.loadIntoCache(providerId);
  }

  // TTL tuyệt đối kể từ lúc load, KHÁC lastAccessed — nếu chỉ dựa vào
  // lastAccessed (tự làm mới mỗi lần đọc), 1 provider dùng liên tục sẽ không
  // bao giờ đọc lại DB. Khi chạy nhiều instance (scale ngang), refresh token
  // reactive (DynamicToolExecutorService) chỉ cập nhật RAM của ĐÚNG 1
  // instance vừa xử lý — các instance khác phải tự hết hạn để đọc lại DB,
  // nếu không sẽ giữ token cũ (đã bị rotate/vô hiệu) vĩnh viễn.
  private isStale(entry: CacheEntry): boolean {
    return Date.now() - entry.loadedAt > this.CACHE_TTL_MS;
  }

  // Gọi ngay sau khi DynamicToolExecutorService mutate token trong RAM (401 → renew).
  // loadIntoCache() (trigger bởi TTL) có thể chạy gần như đồng thời và đọc lại DB TRƯỚC
  // KHI queue job persist token mới kịp chạy xong — không có mốc này, nó sẽ ghi đè RAM
  // bằng token CŨ vừa đọc được từ DB, làm mất token vừa refresh.
  markTokenRefreshed(providerId: string): void {
    const entry = this.registry.get(providerId);
    if (entry) entry.tokenMutatedAt = Date.now();
  }

  // RAM mới hơn DB khi nó vừa được reactive-refresh (markTokenRefreshed) SAU lần DB
  // được ghi gần nhất (entity.updatedAt) — tức là queue job persist token đó chưa
  // kịp chạy xong. Ngược lại (bình thường, hoặc DB vừa được nơi khác cập nhật mới hơn)
  // thì DB mới là nguồn đáng tin.
  private shouldKeepRamToken(
    existing: CacheEntry | undefined,
    entity: DynamicProviderEntity,
  ): boolean {
    return (
      existing?.tokenMutatedAt !== undefined &&
      !!entity.updatedAt &&
      existing.tokenMutatedAt > entity.updatedAt.getTime()
    );
  }

  private async loadIntoCache(providerId: string): Promise<void> {
    const entity = await this.providerRepo.findOne({
      where: { id: providerId, isActive: true },
    });
    if (!entity) {
      throw new RpcException({
        ...ORCHESTRATION_ERROR.DYNAMIC_PROVIDER_NOT_FOUND,
        details: `Dynamic provider ${providerId} not found in DB`,
      });
    }

    const existing = this.registry.get(providerId);
    const keepRamToken = this.shouldKeepRamToken(existing, entity);

    try {
      const document = await this.parserService.loadSpec(entity.specUrl);
      const tools = OpenApiConverter.convertToMcpTools(document);
      const now = Date.now();

      this.registry.set(providerId, {
        data: {
          providerId,
          specUrl: entity.specUrl,
          document,
          tools,
          accessToken: keepRamToken
            ? existing!.data.accessToken
            : entity.accessToken,
          authType: entity.authType,
          refreshToken: keepRamToken
            ? existing!.data.refreshToken
            : entity.refreshToken,
          tokenExpiresAt: keepRamToken
            ? existing!.data.tokenExpiresAt
            : entity.tokenExpiresAt,
          authConfig: entity.authConfig,
        },
        lastAccessed: now,
        loadedAt: now,
        tokenMutatedAt: keepRamToken ? existing!.tokenMutatedAt : undefined,
      });
      this.logger.log(`Lazy-loaded dynamic provider "${providerId}" into RAM.`);
    } catch (error: any) {
      this.logger.error(
        `Failed to lazy-load dynamic provider "${providerId}": ${error.message}`,
      );
      // Lỗi từ ParserService vốn đã là RpcException (INVALID_OPENAPI_SPEC), nên ta cứ ném thẳng nó ra
      if (error instanceof RpcException) {
        throw error;
      }
      // Nếu là lỗi lạ từ quá trình converter
      throw new RpcException({
        ...ORCHESTRATION_ERROR.INVALID_OPENAPI_SPEC,
        details: error.message,
      });
    }
  }

  /**
   * Lấy danh sách các tools đã parse cho provider này để đưa vào LLM.
   *
   * `query` (thường là dto.prompt — câu hỏi hiện tại của user) chỉ được dùng khi > 128 tools: xếp
   * hạng theo mức liên quan ngữ nghĩa (Tool RAG) và chỉ trả về top `SEMANTIC_SEARCH_TOP_K`, thay vì
   * cắt cứng theo thứ tự xuất hiện trong spec. Không truyền `query` (hoặc embedding provider lỗi) →
   * fallback về hành vi cũ (cắt 128 tool đầu) để không phá vỡ các endpoint không có ngữ cảnh câu hỏi
   * (vd danh sách tool hiển thị UI).
   */
  async getTools(providerId: string, query?: string): Promise<McpToolDto[]> {
    await this.ensureLoaded(providerId);
    const entry = this.registry.get(providerId)!;
    const tools = entry.data.tools;

    if (tools.length <= 128) return tools;

    if (query) {
      try {
        const index = await this.getOrBuildSemanticIndex(entry, tools);
        const ranked = await index.search(query, SEMANTIC_SEARCH_TOP_K);
        if (ranked.length > 0) return ranked;
      } catch (error: any) {
        this.logger.warn(
          `Semantic tool search failed for provider ${providerId}, falling back to the first 128 tools: ${error.message}`,
        );
      }
    }

    // Khắc phục lỗi "Invalid 'tools': array too long. Expected an array with maximum of 128 items" của OpenAI gpt-4o-mini
    this.logger.warn(
      `Provider ${providerId} có ${tools.length} tools. Tạm thời cắt xuống 128 để tránh lỗi 400 từ OpenAI.`,
    );
    return tools.slice(0, 128);
  }

  /** Embeds the tool set once per cache entry — reused across every search() until the entry itself
   *  is reloaded (see CacheEntry.semanticIndex). */
  private async getOrBuildSemanticIndex(
    entry: CacheEntry,
    tools: McpToolDto[],
  ): Promise<SemanticToolIndex<IndexableMcpTool>> {
    if (entry.semanticIndex) return entry.semanticIndex;

    const index = new SemanticToolIndex<IndexableMcpTool>(
      this.embeddingProvider,
    );
    const indexable: IndexableMcpTool[] = tools.map((tool) => ({
      ...tool,
      description: tool.description ?? '',
    }));
    await index.build(indexable);

    entry.semanticIndex = index;
    return index;
  }

  /**
   * Lấy toàn bộ document (spec gốc) để dùng cho Tool Executor
   */
  async getSpec(providerId: string): Promise<OpenAPI.Document> {
    await this.ensureLoaded(providerId);
    return this.registry.get(providerId)!.data.document;
  }

  /**
   * Lấy cấu hình đầy đủ của provider (bao gồm apiKey)
   */
  async getProviderSpec(providerId: string): Promise<DynamicProviderSpec> {
    await this.ensureLoaded(providerId);
    return this.registry.get(providerId)!.data;
  }

  /**
   * Kiểm tra xem providerId có phải là dynamic provider không
   */
  async isDynamicProvider(providerId: string): Promise<boolean> {
    if (this.registry.has(providerId)) return true;
    const count = await this.providerRepo.count({
      where: { id: providerId, isActive: true },
    });
    return count > 0;
  }

  /**
   * Lấy danh sách tất cả các dynamic providers hiện đang có trong bộ nhớ
   */
  getAllProviders(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * Xoá một dynamic provider khỏi bộ nhớ (VD: khi user xoá tích hợp)
   */
  removeProvider(providerId: string): void {
    this.registry.delete(providerId);
    this.logger.log(`Removed dynamic provider "${providerId}"`);
  }
}
