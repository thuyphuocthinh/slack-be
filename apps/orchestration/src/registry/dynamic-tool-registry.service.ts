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
  lastAccessed: number;
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
  ) { 
    // Định kỳ 30 phút quét 1 lần để dọn rác RAM
    this.cleanupInterval = setInterval(() => this.cleanupExpiredCache(), buildTTL('MINUTE', 30));
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
      this.logger.log(`Cleaned up ${deletedCount} unused dynamic providers from RAM to free memory.`);
    }
  }

  /**
   * Đảm bảo provider đã được load từ DB và parse thành công vào RAM
   */
  private async ensureLoaded(providerId: string): Promise<void> {
    const existing = this.registry.get(providerId);
    if (existing) {
      // Cập nhật lại thời gian truy cập để không bị xóa
      existing.lastAccessed = Date.now();
      return;
    }

    const entity = await this.providerRepo.findOne({ where: { id: providerId, isActive: true } });
    if (!entity) {
      throw new RpcException({
        ...ORCHESTRATION_ERROR.DYNAMIC_PROVIDER_NOT_FOUND,
        details: `Dynamic provider ${providerId} not found in DB`,
      });
    }

    try {
      const document = await this.parserService.loadSpec(entity.specUrl);
      const tools = OpenApiConverter.convertToMcpTools(document);
      
      this.registry.set(providerId, {
        data: {
          providerId,
          specUrl: entity.specUrl,
          document,
          tools,
          accessToken: entity.accessToken,
          authType: entity.authType,
          refreshToken: entity.refreshToken,
          tokenExpiresAt: entity.tokenExpiresAt,
          authConfig: entity.authConfig,
        },
        lastAccessed: Date.now()
      });
      this.logger.log(`Lazy-loaded dynamic provider "${providerId}" into RAM.`);
    } catch (error: any) {
      this.logger.error(`Failed to lazy-load dynamic provider "${providerId}": ${error.message}`);
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
   * Lấy danh sách các tools đã parse cho provider này để đưa vào LLM
   */
  async getTools(providerId: string): Promise<McpToolDto[]> {
    await this.ensureLoaded(providerId);
    const tools = this.registry.get(providerId)!.data.tools;
    
    // Khắc phục lỗi "Invalid 'tools': array too long. Expected an array with maximum of 128 items" của OpenAI gpt-4o-mini
    if (tools.length > 128) {
      this.logger.warn(`Provider ${providerId} có ${tools.length} tools. Tạm thời cắt xuống 128 để tránh lỗi 400 từ OpenAI.`);
      return tools.slice(0, 128);
    }
    
    return tools;
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
    const count = await this.providerRepo.count({ where: { id: providerId, isActive: true } });
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
