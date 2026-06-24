import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { UserIntegrationEntity } from './entity/user-integration.entity';
import { CachedService, CACHE } from '@slack/cached';
import { IntegrationProvider, IntegrationTargetType, IntegrationStatus } from '@slack/constants';
import {
  GenerateAuthUrlRequestDto,
  HandleCallbackRequestDto,
  RevokeConnectionRequestDto,
  GetMyConnectionsResponseDto,
  GenerateAuthUrlResponseDto,
  HandleCallbackResponseDto,
  RevokeConnectionResponseDto,
  SaveApiKeyRequestDto,
  SaveApiKeyResponseDto
} from './dto/auth.dto';
import { GoogleStrategy } from './strategies/google.strategy';
import { IOAuthStrategy } from './strategies/base.strategy';
import { RpcException } from '@nestjs/microservices';
import { INTEGRATION_ERROR } from '@slack/constants';
import { encryptString, decryptString } from '@slack/common';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserIntegrationEntity)
    private readonly integrationRepo: Repository<UserIntegrationEntity>,
    private readonly googleStrategy: GoogleStrategy,
    private readonly cachedService: CachedService,
  ) { }

  private getStrategy(provider: string): IOAuthStrategy {
    switch (provider) {
      case IntegrationProvider.GOOGLE:
        return this.googleStrategy;
      default:
        throw new RpcException(INTEGRATION_ERROR.PROVIDER_NOT_SUPPORTED);
    }
  }

  async getMyConnections(userId: string): Promise<GetMyConnectionsResponseDto> {
    const connections = await this.integrationRepo.find({
      where: { userId },
      select: ['id', 'provider', 'providerAccountId', 'targetType', 'workspaceId', 'scopes', 'status', 'metadata', 'createdAt'],
    });
    return { 
      connections: connections.map(conn => ({
        id: conn.id,
        provider: conn.provider,
        providerAccountId: conn.providerAccountId || undefined,
        targetType: conn.targetType,
        workspaceId: conn.workspaceId || undefined,
        scopes: conn.scopes || undefined,
        status: conn.status,
        metadata: conn.metadata || undefined,
        createdAt: conn.createdAt,
      }))
    };
  }

  async getConnectionByProvider(userId: string, provider: IntegrationProvider): Promise<{ id: string; userId: string; provider: string } | null> {
    const connection = await this.integrationRepo.findOne({
      where: { userId, provider, status: IntegrationStatus.CONNECTED },
      select: ['id', 'userId', 'provider'],
    });
    if (!connection) return null;
    
    return {
      id: connection.id,
      userId: connection.userId,
      provider: connection.provider,
    };
  }

  async generateAuthUrl(payload: GenerateAuthUrlRequestDto): Promise<GenerateAuthUrlResponseDto> {
    const strategy = this.getStrategy(payload.provider);
    
    // Generate state ID
    const stateId = uuidv4();
    const statePayload = {
      userId: payload.userId,
      workspaceId: payload.workspaceId,
      provider: payload.provider,
      scopes: payload.scopes,
      targetType: payload.targetType || IntegrationTargetType.USER,
      returnUrl: payload.returnUrl,
    };
    
    // Save state context to Redis
    await this.cachedService.set(CACHE.INTEGRATION.KEYS.OAUTH_STATE(stateId), statePayload, CACHE.INTEGRATION.SETTINGS.OAUTH_STATE_TTL);
    
    const authUrl = await strategy.getAuthUrl(stateId, payload.workspaceId, payload.scopes);
    return { authUrl };
  }

  async handleCallback(payload: HandleCallbackRequestDto): Promise<HandleCallbackResponseDto> {
    try {
      const stateId = payload.state;
      const statePayload = await this.cachedService.get<any>(CACHE.INTEGRATION.KEYS.OAUTH_STATE(stateId));
      
      if (!statePayload) {
        throw new RpcException(INTEGRATION_ERROR.INVALID_STATE);
      }
      
      const { userId, workspaceId, scopes, targetType, returnUrl, provider: trustedProvider } = statePayload;
      
      // Use provider from Redis state (trusted) instead of URL param (user-controlled)
      // Validate they match to detect tampering
      if (payload.provider !== trustedProvider) {
        this.logger.warn(`Provider mismatch: URL=${payload.provider}, State=${trustedProvider}`);
        throw new RpcException(INTEGRATION_ERROR.INVALID_STATE);
      }

      const strategy = this.getStrategy(trustedProvider);

      const { accessToken, refreshToken, expiryDate, metadata, providerAccountId } = await strategy.exchangeToken(payload.code);

      // Save or update connection
      let connection = await this.integrationRepo.findOne({
        where: { 
          userId, 
          provider: trustedProvider as IntegrationProvider,
          providerAccountId: providerAccountId || IsNull()
        },
      });

      if (!connection) {
        connection = this.integrationRepo.create({
          userId,
          provider: trustedProvider as IntegrationProvider,
          providerAccountId: providerAccountId || null,
        });
      }

      connection.workspaceId = workspaceId || null;
      connection.targetType = targetType;
      connection.accessToken = encryptString(accessToken);
      connection.status = IntegrationStatus.CONNECTED;
      if (scopes) {
        connection.scopes = scopes;
      }
      if (refreshToken) {
        connection.refreshToken = encryptString(refreshToken);
      }
      if (expiryDate) {
        connection.tokenExpiry = expiryDate;
      }
      if (metadata) {
        connection.metadata = metadata;
      }

      await this.integrationRepo.save(connection);

      // Cleanup state
      await this.cachedService.del(CACHE.INTEGRATION.KEYS.OAUTH_STATE(stateId));

      return { success: true, provider: trustedProvider, returnUrl };
    } catch (error) {
      this.logger.error('Error handling OAuth callback', error);
      if (error instanceof RpcException) {
        throw error;
      }
      throw new RpcException(INTEGRATION_ERROR.OAUTH_FAILED);
    }
  }

  async revokeConnection(payload: RevokeConnectionRequestDto): Promise<RevokeConnectionResponseDto> {
    // Support multi-account: if connectionId is provided, use it directly
    // Otherwise fallback to userId + provider (legacy / single-account)
    const where = payload.connectionId 
      ? { id: payload.connectionId, userId: payload.userId }
      : { userId: payload.userId, provider: payload.provider as IntegrationProvider };

    const connection = await this.integrationRepo.findOne({ where });

    if (!connection) {
      throw new RpcException(INTEGRATION_ERROR.CONNECTION_NOT_FOUND);
    }

    await this.integrationRepo.remove(connection);
    return { success: true };
  }

  async getValidAccessToken(integrationId: string): Promise<string> {
    // Wrap in a transaction with pessimistic lock to prevent multiple concurrent requests (e.g., background jobs)
    // from trying to refresh the same token simultaneously, leading to race conditions and multiple Google API calls.
    return this.integrationRepo.manager.transaction(async (manager) => {
      const connection = await manager.findOne(UserIntegrationEntity, { 
        where: { id: integrationId },
        lock: { mode: 'pessimistic_write' },
      });
      
      if (!connection) {
        throw new RpcException(INTEGRATION_ERROR.CONNECTION_NOT_FOUND);
      }

      if (connection.status === IntegrationStatus.DISCONNECTED) {
        throw new RpcException(INTEGRATION_ERROR.OAUTH_FAILED);
      }

      // Check if token is expired or expiring in next 5 minutes
      const now = new Date();
      const expiryDate = connection.tokenExpiry;
      
      if (expiryDate && expiryDate.getTime() - now.getTime() < 5 * 60 * 1000) {
        if (!connection.refreshToken) {
          // No refresh token, mark as disconnected
          connection.status = IntegrationStatus.DISCONNECTED;
          await manager.save(connection);
          throw new RpcException(INTEGRATION_ERROR.OAUTH_FAILED);
        }

        try {
          const strategy = this.getStrategy(connection.provider);
          if (!strategy.refreshToken) {
            throw new Error('Strategy does not support refresh token');
          }

          const { accessToken, refreshToken, expiryDate: newExpiry } = await strategy.refreshToken(decryptString(connection.refreshToken));
          
          connection.accessToken = encryptString(accessToken);
          if (refreshToken) connection.refreshToken = encryptString(refreshToken);
          if (newExpiry) connection.tokenExpiry = newExpiry;

          await manager.save(connection);
          return accessToken; // Return plain text for the caller
        } catch (error) {
          this.logger.error(`Failed to refresh token for integration ${integrationId}`, error);
          connection.status = IntegrationStatus.DISCONNECTED;
          await manager.save(connection);
          throw new RpcException(INTEGRATION_ERROR.OAUTH_FAILED);
        }
      }

      return decryptString(connection.accessToken);
    });
  }

  async saveApiKey(payload: SaveApiKeyRequestDto): Promise<SaveApiKeyResponseDto> {
    const { userId, workspaceId, provider, apiKey } = payload;
    
    let connection = await this.integrationRepo.findOne({
      where: {
        userId,
        provider: provider as IntegrationProvider,
      }
    });

    if (!connection) {
      connection = this.integrationRepo.create({
        userId,
        workspaceId: workspaceId || null,
        provider: provider as IntegrationProvider,
        targetType: workspaceId ? IntegrationTargetType.WORKSPACE : IntegrationTargetType.USER,
        status: IntegrationStatus.CONNECTED,
      });
    } else {
      connection.status = IntegrationStatus.CONNECTED;
      connection.workspaceId = workspaceId || null;
      connection.targetType = workspaceId ? IntegrationTargetType.WORKSPACE : IntegrationTargetType.USER;
    }

    // Since this is an API key and not an OAuth token, we encrypt it in accessToken
    connection.accessToken = encryptString(apiKey);
    
    const saved = await this.integrationRepo.save(connection);
    return { success: true, connectionId: saved.id };
  }
}
