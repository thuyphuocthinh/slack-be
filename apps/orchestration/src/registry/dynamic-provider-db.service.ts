import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DynamicProviderEntity,
  DynamicProviderAuthConfig,
} from '../entity/dynamic-provider.entity';
import { DynamicToolRegistryService } from './dynamic-tool-registry.service';
import { DynamicProviderDto } from '../dto/orchestration.dto';
import { OpenApiParserService } from '../parser/openapi-parser.service';
import { EDynamicProviderAuthType } from '../entity/dynamic-provider.entity';
import { RpcException } from '@nestjs/microservices';
import { ORCHESTRATION_ERROR } from '@slack/constants';
import { v4 as uuidv4 } from 'uuid';

export interface CreateDynamicProviderParams {
  userId: string;
  name: string;
  specUrl: string;
  description?: string;
  accessToken?: string;
  authType?: EDynamicProviderAuthType;
  // OAUTH2 auto-renew (DynamicToolExecutorService.handleOAuth2AutoRenew) needs all 3 of these —
  // missing any one of them makes it a permanent no-op (silently never refreshes).
  refreshToken?: string;
  tokenExpiresAt?: Date;
  authConfig?: DynamicProviderAuthConfig;
}

@Injectable()
export class DynamicProviderDbService {
  private readonly logger = new Logger(DynamicProviderDbService.name);

  constructor(
    @InjectRepository(DynamicProviderEntity)
    private readonly providerRepo: Repository<DynamicProviderEntity>,
    private readonly registryService: DynamicToolRegistryService,
    private readonly parserService: OpenApiParserService,
  ) {}

  /**
   * Tạo 1 tích hợp Swagger mới (Lưu DB)
   */
  async createProvider(
    params: CreateDynamicProviderParams,
  ): Promise<DynamicProviderDto> {
    const id = `dynamic_${uuidv4().replace(/-/g, '')}`;

    // Parse thử xem link có sống không trước khi lưu DB
    await this.parserService.loadSpec(params.specUrl);

    const entity = this.providerRepo.create({
      id,
      userId: params.userId,
      name: params.name,
      specUrl: params.specUrl,
      description: params.description,
      accessToken: params.accessToken,
      authType: params.authType,
      refreshToken: params.refreshToken,
      tokenExpiresAt: params.tokenExpiresAt,
      authConfig: params.authConfig,
    });

    let saved: DynamicProviderEntity;
    try {
      saved = await this.providerRepo.save(entity);
      this.logger.log(
        `Created dynamic provider "${saved.name}" with ID "${saved.id}"`,
      );
    } catch (dbError: any) {
      this.logger.error(`Failed to save provider to DB: ${dbError.message}`);
      throw new RpcException({
        ...ORCHESTRATION_ERROR.DATABASE_OPERATION_FAILED,
        details: 'Could not save dynamic provider to database',
      });
    }

    // Gọi ngay registry service để load spec vào RAM
    try {
      await this.registryService.getTools(saved.id);
    } catch (err) {
      this.logger.error(
        `Failed to load spec for new provider "${saved.name}": ${(err as Error).message}`,
      );
    }

    return this.mapToDto(saved);
  }

  /**
   * Xóa tích hợp Swagger (Xóa DB + Xóa khỏi RAM)
   */
  async deleteProvider(id: string, userId: string): Promise<void> {
    try {
      const provider = await this.providerRepo.findOne({
        where: { id, userId },
      });
      if (!provider) {
        throw new RpcException({
          ...ORCHESTRATION_ERROR.DYNAMIC_PROVIDER_NOT_FOUND,
          details: `Dynamic provider ${id} not found or you don't have permission to delete it.`,
        });
      }

      await this.providerRepo.remove(provider);
      this.registryService.removeProvider(id);
      this.logger.log(
        `Deleted dynamic provider "${provider.name}" with ID "${provider.id}"`,
      );
    } catch (error: any) {
      if (error instanceof RpcException) throw error;

      this.logger.error(`Failed to delete provider ${id}: ${error.message}`);
      throw new RpcException({
        ...ORCHESTRATION_ERROR.DATABASE_OPERATION_FAILED,
        details: 'Could not delete dynamic provider from database',
      });
    }
  }

  /**
   * Lấy danh sách provider Swagger của 1 user
   */
  async getProvidersByUser(userId: string): Promise<DynamicProviderDto[]> {
    const entities = await this.providerRepo.find({ where: { userId } });
    return entities.map((e) => this.mapToDto(e));
  }

  private mapToDto(entity: DynamicProviderEntity): DynamicProviderDto {
    return {
      id: entity.id,
      userId: entity.userId,
      name: entity.name,
      specUrl: entity.specUrl,
      description: entity.description,
      hasAuth: !!entity.accessToken || !!entity.refreshToken,
      authType: entity.authType,
      tokenExpiresAt: entity.tokenExpiresAt,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
