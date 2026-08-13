import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DynamicProviderEntity,
  DynamicProviderAuthConfig,
} from '../entity/dynamic-provider.entity';
import { DynamicToolRegistryService } from './dynamic-tool-registry.service';
import {
  DynamicProviderDto,
  RegisterDynamicProviderRequestDto,
  UpdateDynamicProviderRequestDto,
} from '../dto/orchestration.dto';
import { OpenApiParserService } from '../parser/openapi-parser.service';
import { EDynamicProviderAuthType } from '../entity/dynamic-provider.entity';
import { RpcException } from '@nestjs/microservices';
import { ERefreshFormat, ORCHESTRATION_ERROR } from '@slack/constants';
import { v4 as uuidv4 } from 'uuid';
import {
  OAuth2TokenState,
  Oauth2RefreshTokenRefresher,
} from '../common/agentic-openapi-parser';
import { inferOAuth2RefreshFormat } from '../common/oauth2-refresh-format.util';

export interface CreateDynamicProviderParams {
  userId: string;
  name: string;
  specUrl: string;
  description?: string;
  accessToken?: string;
  authType?: EDynamicProviderAuthType;
  // OAUTH2 reactive renew (DynamicToolExecutorService.tryRenewOAuth2Token, triggered on a 401)
  // needs refreshToken + authConfig.tokenUrl/clientId/clientSecret — missing refreshToken or
  // tokenUrl makes it a permanent no-op.
  refreshToken?: string;
  /** Informational only — not required for the reactive renew (which triggers off an actual 401,
   *  not this timestamp). Set once by the controller's eager-refresh-at-connect step. */
  tokenExpiresAt?: Date;
  authConfig?: DynamicProviderAuthConfig;
}

interface OAuth2InputFields {
  accessToken?: string;
  refreshToken?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  refreshRequestFormat?: ERefreshFormat;
  responseAccessTokenPath?: string;
  responseRefreshTokenPath?: string;
  responseExpiresInPath?: string;
  defaultExpiresInSecs?: number;
}

@Injectable()
export class DynamicProviderDbService {
  private readonly logger = new Logger(DynamicProviderDbService.name);

  constructor(
    @InjectRepository(DynamicProviderEntity)
    private readonly providerRepo: Repository<DynamicProviderEntity>,
    private readonly registryService: DynamicToolRegistryService,
    private readonly parserService: OpenApiParserService,
  ) { }

  /**
   * Đăng ký 1 tích hợp Swagger mới từ request của user — resolve xong OAuth2 credentials
   * (eager-refresh nếu cần) rồi mới gọi createProvider() để lưu DB.
   */
  async registerProvider(
    dto: RegisterDynamicProviderRequestDto,
  ): Promise<DynamicProviderDto> {
    const fields = this.resolveOAuth2Fields(dto);
    let tokenExpiresAt: Date | undefined;

    // User không thể biết trước "expires_in" của access token họ paste vào. Nếu có đủ
    // refreshToken + tokenUrl, refresh ngay 1 lần lúc đăng ký: vừa lấy được expires_in thật từ
    // chính provider (không cần hỏi user), vừa xác nhận sớm bộ refresh credential có hoạt động
    // không thay vì để tới lúc access token hết hạn mới phát hiện là refresh không tự chạy được.
    const refreshed = await this.refreshOAuth2IfConfigured(fields);
    if (refreshed) {
      fields.accessToken = refreshed.accessToken;
      fields.refreshToken = refreshed.refreshToken;
      tokenExpiresAt = refreshed.tokenExpiresAt;
    }

    this.assertUsableAuthConfig(
      dto.authType,
      fields.accessToken,
      fields.refreshToken,
      fields.tokenUrl,
    );

    return this.createProvider({
      userId: dto.userId,
      name: dto.name,
      specUrl: dto.specUrl,
      accessToken: fields.accessToken,
      authType: dto.authType,
      description: dto.description,
      refreshToken: fields.refreshToken,
      tokenExpiresAt,
      authConfig: this.buildAuthConfig(fields),
    });
  }

  /**
   * Cập nhật ("Kết nối lại") 1 dynamic provider đã tồn tại — giữ nguyên ID/tools đã parse.
   * Field nào không truyền thì giữ nguyên giá trị cũ (đặc biệt quan trọng cho secret — user không
   * cần dán lại accessToken/clientSecret nếu chỉ muốn sửa 1 field khác). Nếu có đủ
   * refreshToken + tokenUrl (mới hoặc cũ), luôn thử lấy 1 access token mới ngay — đúng ý "kết nối
   * lại" là để có token còn hạn, không chỉ đơn thuần lưu lại config cũ.
   */
  async updateProvider(
    dto: UpdateDynamicProviderRequestDto,
  ): Promise<DynamicProviderDto> {
    const entity = await this.findOwnedProviderOrThrow(
      dto.providerId,
      dto.userId,
      'update',
    );

    const originalRefreshToken = entity.refreshToken;
    const authType = dto.authType ?? entity.authType;
    const fields = this.resolveOAuth2Fields(dto, entity);
    let tokenExpiresAt = entity.tokenExpiresAt;

    const refreshed = await this.refreshOAuth2IfConfigured(fields);
    if (refreshed) {
      fields.accessToken = refreshed.accessToken;
      fields.refreshToken = refreshed.refreshToken;
      tokenExpiresAt = refreshed.tokenExpiresAt;
    }

    // specUrl đổi thì validate lại trước khi lưu — tránh lưu 1 spec hỏng (giống createProvider).
    if (dto.specUrl && dto.specUrl !== entity.specUrl) {
      await this.parserService.loadSpec(dto.specUrl);
    }

    this.assertUsableAuthConfig(
      authType,
      fields.accessToken,
      fields.refreshToken,
      fields.tokenUrl,
    );

    entity.name = dto.name || entity.name;
    entity.specUrl = dto.specUrl || entity.specUrl;
    entity.description = dto.description ?? entity.description;
    entity.authType = authType;
    entity.accessToken = fields.accessToken;
    entity.refreshToken = fields.refreshToken;
    entity.tokenExpiresAt = tokenExpiresAt;
    entity.authConfig = this.buildAuthConfig(fields);

    await this.persistUpdatedProvider(entity, originalRefreshToken);

    // Xoá cache RAM cũ để lần gọi tool tiếp theo đọc lại credentials/spec mới từ DB — registry chỉ
    // tự đọc lại DB khi chưa có trong cache (xem DynamicToolRegistryService.ensureLoaded).
    this.registryService.removeProvider(entity.id);
    await this.reloadRegistryTools(entity, 'reload spec for updated');

    return this.mapToDto(entity);
  }

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

    await this.reloadRegistryTools(saved, 'load spec for new');

    return this.mapToDto(saved);
  }

  /**
   * Xóa tích hợp Swagger (Xóa DB + Xóa khỏi RAM)
   */
  async deleteProvider(id: string, userId: string): Promise<void> {
    try {
      const provider = await this.findOwnedProviderOrThrow(id, userId, 'delete');

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
      hasAccessToken: !!entity.accessToken,
      hasRefreshToken: !!entity.refreshToken,
      hasTokenUrl: !!entity.authConfig?.tokenUrl,
      tokenExpiresAt: entity.tokenExpiresAt,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * Dùng chung cho registerProvider()/updateProvider() — field nào dto không truyền thì fallback
   * về entity đang có (entity undefined ở registerProvider, coi như luôn dùng thẳng giá trị dto).
   */
  private resolveOAuth2Fields(
    dto: OAuth2InputFields,
    existing?: DynamicProviderEntity,
  ): OAuth2InputFields {
    const tokenUrl = dto.tokenUrl || existing?.authConfig?.tokenUrl;
    return {
      accessToken: dto.accessToken || existing?.accessToken,
      refreshToken: dto.refreshToken || existing?.refreshToken,
      tokenUrl,
      clientId: dto.clientId || existing?.authConfig?.clientId,
      clientSecret: dto.clientSecret || existing?.authConfig?.clientSecret,
      refreshRequestFormat: tokenUrl
        ? (dto.refreshRequestFormat ??
          existing?.authConfig?.refreshRequestFormat ??
          inferOAuth2RefreshFormat(tokenUrl))
        : undefined,
      responseAccessTokenPath:
        dto.responseAccessTokenPath ??
        existing?.authConfig?.responseAccessTokenPath,
      responseRefreshTokenPath:
        dto.responseRefreshTokenPath ??
        existing?.authConfig?.responseRefreshTokenPath,
      responseExpiresInPath:
        dto.responseExpiresInPath ?? existing?.authConfig?.responseExpiresInPath,
      defaultExpiresInSecs:
        dto.defaultExpiresInSecs ?? existing?.authConfig?.defaultExpiresInSecs,
    };
  }

  private buildAuthConfig(
    fields: OAuth2InputFields,
  ): DynamicProviderAuthConfig | undefined {
    if (!fields.tokenUrl && !fields.clientId && !fields.clientSecret) {
      return undefined;
    }
    return {
      tokenUrl: fields.tokenUrl,
      clientId: fields.clientId,
      clientSecret: fields.clientSecret,
      refreshRequestFormat: fields.refreshRequestFormat,
      responseAccessTokenPath: fields.responseAccessTokenPath,
      responseRefreshTokenPath: fields.responseRefreshTokenPath,
      responseExpiresInPath: fields.responseExpiresInPath,
      defaultExpiresInSecs: fields.defaultExpiresInSecs,
    };
  }

  private async findOwnedProviderOrThrow(
    id: string,
    userId: string,
    verb: 'update' | 'delete',
  ): Promise<DynamicProviderEntity> {
    const entity = await this.providerRepo.findOne({ where: { id, userId } });
    if (!entity) {
      throw new RpcException({
        ...ORCHESTRATION_ERROR.DYNAMIC_PROVIDER_NOT_FOUND,
        details: `Dynamic provider ${id} not found or you don't have permission to ${verb} it.`,
      });
    }
    return entity;
  }

  // CAS theo refreshToken đọc lúc findOne() — nếu 1 reactive-refresh (401) khác đã xoay
  // refreshToken trong lúc updateProvider() chạy, affected=0 và bản cập nhật này KHÔNG được đè lên.
  private async persistUpdatedProvider(
    entity: DynamicProviderEntity,
    originalRefreshToken: string | undefined,
  ): Promise<void> {
    try {
      const result = await this.providerRepo.update(
        { id: entity.id, refreshToken: originalRefreshToken },
        {
          name: entity.name,
          specUrl: entity.specUrl,
          description: entity.description,
          authType: entity.authType,
          accessToken: entity.accessToken,
          refreshToken: entity.refreshToken,
          tokenExpiresAt: entity.tokenExpiresAt,
          authConfig: entity.authConfig as any,
        },
      );
      if (result.affected === 0) {
        throw new RpcException({
          ...ORCHESTRATION_ERROR.DYNAMIC_PROVIDER_CONCURRENT_UPDATE,
          details: `Dynamic provider ${entity.id} was modified concurrently — please retry.`,
        });
      }
      this.logger.log(
        `Updated dynamic provider "${entity.name}" with ID "${entity.id}"`,
      );
    } catch (dbError: any) {
      if (dbError instanceof RpcException) throw dbError;
      this.logger.error(`Failed to update provider in DB: ${dbError.message}`);
      throw new RpcException({
        ...ORCHESTRATION_ERROR.DATABASE_OPERATION_FAILED,
        details: 'Could not update dynamic provider in database',
      });
    }
  }

  private async reloadRegistryTools(
    entity: DynamicProviderEntity,
    action: 'load spec for new' | 'reload spec for updated',
  ): Promise<void> {
    try {
      await this.registryService.getTools(entity.id);
    } catch (err) {
      this.logger.error(
        `Failed to ${action} provider "${entity.name}": ${(err as Error).message}`,
      );
    }
  }

  /**
   * Dùng chung cho registerProvider()/updateProvider() — refresh ngay 1 lần nếu có đủ
   * refreshToken+tokenUrl, trả null nếu thiếu (không refresh, giữ nguyên giá trị cũ ở nơi gọi).
   * Ném OAUTH2_REFRESH_FAILED nếu ĐÃ thử refresh mà thất bại.
   */
  private async refreshOAuth2IfConfigured(
    params: OAuth2InputFields,
  ): Promise<OAuth2TokenState | null> {
    if (!params.refreshToken || !params.tokenUrl) return null;

    const refresher = new Oauth2RefreshTokenRefresher({
      logger: this.logger,
      requestFormat: params.refreshRequestFormat,
      responseAccessTokenPath: params.responseAccessTokenPath,
      responseRefreshTokenPath: params.responseRefreshTokenPath,
      responseExpiresInPath: params.responseExpiresInPath,
      defaultExpiresInSecs: params.defaultExpiresInSecs,
    });
    const refreshed = await refresher.refreshIfNeeded({
      accessToken: params.accessToken ?? '',
      refreshToken: params.refreshToken,
      tokenExpiresAt: new Date(0), // luôn coi như đã hết hạn để ép refresh ngay
      tokenUrl: params.tokenUrl,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
    });

    if (!refreshed) {
      throw new RpcException({
        ...ORCHESTRATION_ERROR.OAUTH2_REFRESH_FAILED,
        details:
          'Could not obtain an access token using the provided refreshToken/tokenUrl/clientId/clientSecret. Please double check these values.',
      });
    }

    return refreshed;
  }

  /**
   * Chặn lưu 1 provider có authType đòi hỏi xác thực (khác NONE) nhưng cuối cùng không có cách
   * nào để inject credential (không accessToken, không đủ cặp refreshToken+tokenUrl) — tránh lặp
   * lại bug: FE gửi thiếu field/đổi authType mà không kèm credential mới, BE vẫn lưu "thành công"
   * ra 1 provider không bao giờ gọi API thật được.
   */
  private assertUsableAuthConfig(
    authType: EDynamicProviderAuthType | undefined,
    accessToken: string | undefined,
    refreshToken: string | undefined,
    tokenUrl: string | undefined,
  ): void {
    if (!authType || authType === EDynamicProviderAuthType.NONE) return;
    if (accessToken || (refreshToken && tokenUrl)) return;

    throw new RpcException({
      ...ORCHESTRATION_ERROR.INVALID_AUTH_CONFIG,
      details: `authType "${authType}" requires either an accessToken or a refreshToken+tokenUrl pair, but none were provided or already stored.`,
    });
  }
}
