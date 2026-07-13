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
import { ORCHESTRATION_ERROR } from '@slack/constants';
import { v4 as uuidv4 } from 'uuid';
import { Oauth2RefreshTokenRefresher } from '../common/agentic-openapi-parser';
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
   * Đăng ký 1 tích hợp Swagger mới từ request của user — resolve xong OAuth2 credentials
   * (eager-refresh nếu cần) rồi mới gọi createProvider() để lưu DB.
   */
  async registerProvider(
    dto: RegisterDynamicProviderRequestDto,
  ): Promise<DynamicProviderDto> {
    const hasAuthConfig = dto.tokenUrl || dto.clientId || dto.clientSecret;
    let accessToken = dto.accessToken;
    let refreshToken = dto.refreshToken;
    let tokenExpiresAt: Date | undefined;
    // Đa số token endpoint nhận form-urlencoded — 1 số ít (VD: Atlassian cho Jira/Confluence)
    // bắt buộc JSON. Tự suy ra từ tokenUrl, cho phép FE ghi đè thủ công qua "Nâng cao" nếu cần.
    const refreshRequestFormat = dto.tokenUrl
      ? (dto.refreshRequestFormat ?? inferOAuth2RefreshFormat(dto.tokenUrl))
      : undefined;

    // User không thể biết trước "expires_in" của access token họ paste vào. Nếu có đủ
    // refreshToken + tokenUrl, refresh ngay 1 lần lúc đăng ký: vừa lấy được expires_in thật từ
    // chính provider (không cần hỏi user), vừa xác nhận sớm bộ refresh credential có hoạt động
    // không thay vì để tới lúc access token hết hạn mới phát hiện là refresh không tự chạy được.
    if (dto.refreshToken && dto.tokenUrl) {
      const refresher = new Oauth2RefreshTokenRefresher({
        logger: this.logger,
        requestFormat: refreshRequestFormat,
        responseAccessTokenPath: dto.responseAccessTokenPath,
        responseRefreshTokenPath: dto.responseRefreshTokenPath,
        responseExpiresInPath: dto.responseExpiresInPath,
        defaultExpiresInSecs: dto.defaultExpiresInSecs,
      });
      const refreshed = await refresher.refreshIfNeeded({
        accessToken: dto.accessToken ?? '',
        refreshToken: dto.refreshToken,
        tokenExpiresAt: new Date(0), // luôn coi như đã hết hạn để ép refresh ngay, bất kể accessToken user paste còn hạn hay không
        tokenUrl: dto.tokenUrl,
        clientId: dto.clientId,
        clientSecret: dto.clientSecret,
      });

      if (!refreshed) {
        throw new RpcException({
          ...ORCHESTRATION_ERROR.OAUTH2_REFRESH_FAILED,
          details:
            'Could not obtain an access token using the provided refreshToken/tokenUrl/clientId/clientSecret. Please double check these values.',
        });
      }

      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      tokenExpiresAt = refreshed.tokenExpiresAt;
    }

    return this.createProvider({
      userId: dto.userId,
      name: dto.name,
      specUrl: dto.specUrl,
      accessToken,
      authType: dto.authType,
      description: dto.description,
      refreshToken,
      tokenExpiresAt,
      authConfig: hasAuthConfig
        ? {
            tokenUrl: dto.tokenUrl,
            clientId: dto.clientId,
            clientSecret: dto.clientSecret,
            refreshRequestFormat,
            responseAccessTokenPath: dto.responseAccessTokenPath,
            responseRefreshTokenPath: dto.responseRefreshTokenPath,
            responseExpiresInPath: dto.responseExpiresInPath,
            defaultExpiresInSecs: dto.defaultExpiresInSecs,
          }
        : undefined,
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
    const entity = await this.providerRepo.findOne({
      where: { id: dto.providerId, userId: dto.userId },
    });
    if (!entity) {
      throw new RpcException({
        ...ORCHESTRATION_ERROR.DYNAMIC_PROVIDER_NOT_FOUND,
        details: `Dynamic provider ${dto.providerId} not found or you don't have permission to update it.`,
      });
    }

    const authType = dto.authType ?? entity.authType;
    let accessToken = dto.accessToken || entity.accessToken;
    let refreshToken = dto.refreshToken || entity.refreshToken;
    let tokenExpiresAt = entity.tokenExpiresAt;
    const tokenUrl = dto.tokenUrl || entity.authConfig?.tokenUrl;
    const clientId = dto.clientId || entity.authConfig?.clientId;
    const clientSecret = dto.clientSecret || entity.authConfig?.clientSecret;
    const refreshRequestFormat = tokenUrl
      ? (dto.refreshRequestFormat ??
        entity.authConfig?.refreshRequestFormat ??
        inferOAuth2RefreshFormat(tokenUrl))
      : undefined;
    const responseAccessTokenPath =
      dto.responseAccessTokenPath ?? entity.authConfig?.responseAccessTokenPath;
    const responseRefreshTokenPath =
      dto.responseRefreshTokenPath ??
      entity.authConfig?.responseRefreshTokenPath;
    const responseExpiresInPath =
      dto.responseExpiresInPath ?? entity.authConfig?.responseExpiresInPath;
    const defaultExpiresInSecs =
      dto.defaultExpiresInSecs ?? entity.authConfig?.defaultExpiresInSecs;

    if (refreshToken && tokenUrl) {
      const refresher = new Oauth2RefreshTokenRefresher({
        logger: this.logger,
        requestFormat: refreshRequestFormat,
        responseAccessTokenPath,
        responseRefreshTokenPath,
        responseExpiresInPath,
        defaultExpiresInSecs,
      });
      const refreshed = await refresher.refreshIfNeeded({
        accessToken: accessToken ?? '',
        refreshToken,
        tokenExpiresAt: new Date(0),
        tokenUrl,
        clientId,
        clientSecret,
      });

      if (!refreshed) {
        throw new RpcException({
          ...ORCHESTRATION_ERROR.OAUTH2_REFRESH_FAILED,
          details:
            'Could not obtain an access token using the provided refreshToken/tokenUrl/clientId/clientSecret. Please double check these values.',
        });
      }

      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      tokenExpiresAt = refreshed.tokenExpiresAt;
    }

    // specUrl đổi thì validate lại trước khi lưu — tránh lưu 1 spec hỏng (giống createProvider).
    if (dto.specUrl && dto.specUrl !== entity.specUrl) {
      await this.parserService.loadSpec(dto.specUrl);
    }

    const hasAuthConfig = tokenUrl || clientId || clientSecret;

    entity.name = dto.name || entity.name;
    entity.specUrl = dto.specUrl || entity.specUrl;
    entity.description = dto.description ?? entity.description;
    entity.authType = authType;
    entity.accessToken = accessToken;
    entity.refreshToken = refreshToken;
    entity.tokenExpiresAt = tokenExpiresAt;
    entity.authConfig = hasAuthConfig
      ? {
          tokenUrl,
          clientId,
          clientSecret,
          refreshRequestFormat,
          responseAccessTokenPath,
          responseRefreshTokenPath,
          responseExpiresInPath,
          defaultExpiresInSecs,
        }
      : undefined;

    let saved: DynamicProviderEntity;
    try {
      saved = await this.providerRepo.save(entity);
      this.logger.log(
        `Updated dynamic provider "${saved.name}" with ID "${saved.id}"`,
      );
    } catch (dbError: any) {
      this.logger.error(`Failed to update provider in DB: ${dbError.message}`);
      throw new RpcException({
        ...ORCHESTRATION_ERROR.DATABASE_OPERATION_FAILED,
        details: 'Could not update dynamic provider in database',
      });
    }

    // Xoá cache RAM cũ để lần gọi tool tiếp theo đọc lại credentials/spec mới từ DB — registry chỉ
    // tự đọc lại DB khi chưa có trong cache (xem DynamicToolRegistryService.ensureLoaded).
    this.registryService.removeProvider(saved.id);
    try {
      await this.registryService.getTools(saved.id);
    } catch (err) {
      this.logger.error(
        `Failed to reload spec for updated provider "${saved.name}": ${(err as Error).message}`,
      );
    }

    return this.mapToDto(saved);
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
