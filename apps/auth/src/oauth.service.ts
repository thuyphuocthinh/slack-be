import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';
import * as argon2 from 'argon2';

import { OAuthClientEntity } from './entity/oauth-client.entity';
import { OAuthAuthCodeEntity } from './entity/oauth-auth-code.entity';
import { OAuthTokenEntity } from './entity/oauth-token.entity';
import {
  OAUTH_ERROR,
  NAME_SERVICE_TCP,
  USER_MESSAGE_PATTERNS,
  OAuthScope,
} from '@slack/constants';
import {
  ICreateOAuthClientDto,
  IUpdateOAuthClientDto,
  IOAuthClientResponse,
  IOAuthClientWithSecretResponse,
  IGetOAuthAuthorizeDetailsDto,
  IOAuthAuthorizeDetailsResponse,
  IOAuthApproveConsentDto,
  IOAuthApproveConsentResponse,
  IOAuthTokenExchangeDto,
  IOAuthTokenExchangeResponse,
  IOAuthUserInfoResponse,
} from './types/oauth.interface';

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    @InjectRepository(OAuthClientEntity)
    private readonly clientRepository: Repository<OAuthClientEntity>,
    @InjectRepository(OAuthAuthCodeEntity)
    private readonly authCodeRepository: Repository<OAuthAuthCodeEntity>,
    @InjectRepository(OAuthTokenEntity)
    private readonly tokenRepository: Repository<OAuthTokenEntity>,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  // ================= DEVELOPER CONSOLE =================

  async createClient(ownerId: string, data: ICreateOAuthClientDto): Promise<IOAuthClientWithSecretResponse> {
    const clientId = crypto.randomUUID();
    const plainSecret = crypto.randomBytes(32).toString('hex');
    const hashedSecret = await argon2.hash(plainSecret);

    const client = this.clientRepository.create({
      ownerId,
      name: data.name,
      logoUrl: data.logoUrl || null,
      clientId,
      clientSecret: hashedSecret,
      redirectUris: data.redirectUris,
      allowedScopes: [OAuthScope.OPENID, OAuthScope.PROFILE, OAuthScope.EMAIL],
    });

    const savedClient = await this.clientRepository.save(client);

    return {
      ...this.mapClientToResponse(savedClient),
      clientSecret: plainSecret,
    };
  }

  async getClients(ownerId: string): Promise<IOAuthClientResponse[]> {
    const clients = await this.clientRepository.find({
      where: { ownerId },
      order: { createdAt: 'DESC' },
    });
    return clients.map(client => this.mapClientToResponse(client));
  }

  async getClientDetails(ownerId: string, id: string): Promise<IOAuthClientResponse> {
    const client = await this.clientRepository.findOne({
      where: { id, ownerId },
    });

    if (!client) {
      throw new RpcException(OAUTH_ERROR.CLIENT_NOT_FOUND);
    }

    return this.mapClientToResponse(client);
  }

  async updateClient(ownerId: string, id: string, data: IUpdateOAuthClientDto): Promise<IOAuthClientResponse> {
    const client = await this.clientRepository.findOne({
      where: { id, ownerId },
    });

    if (!client) {
      throw new RpcException(OAUTH_ERROR.CLIENT_NOT_FOUND);
    }

    if (data.name !== undefined) client.name = data.name;
    if (data.logoUrl !== undefined) client.logoUrl = data.logoUrl;
    if (data.redirectUris !== undefined) client.redirectUris = data.redirectUris;
    if (data.allowedScopes !== undefined) client.allowedScopes = data.allowedScopes;

    const updatedClient = await this.clientRepository.save(client);
    return this.mapClientToResponse(updatedClient);
  }

  async regenerateClientSecret(ownerId: string, id: string): Promise<IOAuthClientWithSecretResponse> {
    const client = await this.clientRepository.findOne({
      where: { id, ownerId },
    });

    if (!client) {
      throw new RpcException(OAUTH_ERROR.CLIENT_NOT_FOUND);
    }

    const plainSecret = crypto.randomBytes(32).toString('hex');
    client.clientSecret = await argon2.hash(plainSecret);

    const updatedClient = await this.clientRepository.save(client);

    return {
      ...this.mapClientToResponse(updatedClient),
      clientSecret: plainSecret,
    };
  }

  async deleteClient(ownerId: string, id: string): Promise<boolean> {
    const result = await this.clientRepository.delete({ id, ownerId });

    if (result.affected === 0) {
      throw new RpcException(OAUTH_ERROR.CLIENT_NOT_FOUND);
    }

    return true;
  }

  // ================= OAUTH PROVIDER FLOW =================

  async getAuthorizeDetails(data: IGetOAuthAuthorizeDetailsDto): Promise<IOAuthAuthorizeDetailsResponse> {
    const client = await this.clientRepository.findOne({
      where: { clientId: data.clientId },
    });

    if (!client) {
      throw new RpcException(OAUTH_ERROR.CLIENT_NOT_FOUND);
    }

    if (!client.redirectUris.includes(data.redirectUri)) {
      throw new RpcException(OAUTH_ERROR.REDIRECT_URI_MISMATCH);
    }

    return {
      clientName: client.name,
      clientLogoUrl: client.logoUrl,
      allowedScopes: client.allowedScopes,
    };
  }

  async approveConsent(userId: string, data: IOAuthApproveConsentDto): Promise<IOAuthApproveConsentResponse> {
    const client = await this.clientRepository.findOne({
      where: { clientId: data.clientId },
    });

    if (!client) {
      throw new RpcException(OAUTH_ERROR.CLIENT_NOT_FOUND);
    }

    if (!client.redirectUris.includes(data.redirectUri)) {
      throw new RpcException(OAUTH_ERROR.REDIRECT_URI_MISMATCH);
    }

    // Verify if requested scopes are allowed by client configuration
    const invalidScopes = data.scopes.filter(scope => !client.allowedScopes.includes(scope));
    if (invalidScopes.length > 0) {
      throw new RpcException(OAUTH_ERROR.INVALID_SCOPE);
    }

    const code = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    const authCode = this.authCodeRepository.create({
      code,
      clientId: data.clientId,
      userId,
      redirectUri: data.redirectUri,
      scopes: data.scopes,
      expiresAt,
    });

    await this.authCodeRepository.save(authCode);

    // Format the redirect URL safely
    const parsedUrl = new URL(data.redirectUri);
    parsedUrl.searchParams.append('code', code);

    return {
      redirectUrl: parsedUrl.toString(),
    };
  }

  async exchangeToken(data: IOAuthTokenExchangeDto): Promise<IOAuthTokenExchangeResponse> {
    const client = await this.clientRepository.findOne({
      where: { clientId: data.clientId },
    });

    if (!client) {
      throw new RpcException(OAUTH_ERROR.CLIENT_NOT_FOUND);
    }

    const isSecretValid = await argon2.verify(client.clientSecret, data.clientSecret);
    if (!isSecretValid) {
      throw new RpcException(OAUTH_ERROR.INVALID_CLIENT_SECRET);
    }

    // Perform database transactions to ensure code consumption is atomic (anti-replay)
    return await this.dataSource.transaction(async (manager) => {
      const authCode = await manager.findOne(OAuthAuthCodeEntity, {
        where: { code: data.code },
        lock: { mode: 'pessimistic_write' },
      });

      if (!authCode || authCode.expiresAt.getTime() < Date.now()) {
        throw new RpcException(OAUTH_ERROR.AUTH_CODE_EXPIRED);
      }

      if (authCode.clientId !== data.clientId || authCode.redirectUri !== data.redirectUri) {
        throw new RpcException(OAUTH_ERROR.REDIRECT_URI_MISMATCH);
      }

      // Consume the authorization code immediately
      await manager.remove(authCode);

      // Generate Access Token and Refresh Token
      const tokenExpiresIn = 3600; // 1 hour in seconds
      const expiresAt = new Date(Date.now() + tokenExpiresIn * 1000);

      const tokenPayload = {
        sub: authCode.userId,
        client_id: authCode.clientId,
        scopes: authCode.scopes,
        type: 'oauth_access',
      };

      const accessToken = await this.jwtService.signAsync(tokenPayload, {
        expiresIn: '1h',
      });

      const refreshToken = crypto.randomBytes(40).toString('hex');

      // Save tokens in database
      const oauthToken = manager.create(OAuthTokenEntity, {
        accessToken,
        refreshToken,
        clientId: authCode.clientId,
        userId: authCode.userId,
        expiresAt,
      });

      await manager.save(oauthToken);

      return {
        accessToken,
        refreshToken,
        tokenType: 'Bearer',
        expiresIn: tokenExpiresIn,
      };
    });
  }

  async getUserInfo(accessToken: string): Promise<IOAuthUserInfoResponse> {
    if (!accessToken) {
      throw new RpcException(OAUTH_ERROR.INVALID_TOKEN);
    }

    // 1. Verify token exists in database and is not expired
    const oauthToken = await this.tokenRepository.findOne({
      where: { accessToken },
    });

    if (!oauthToken || oauthToken.expiresAt.getTime() < Date.now()) {
      throw new RpcException(OAUTH_ERROR.INVALID_TOKEN);
    }

    // 2. Decode the JWT to verify signature and pull metadata
    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(accessToken);
    } catch (err) {
      throw new RpcException(OAUTH_ERROR.INVALID_TOKEN);
    }

    // 3. Fetch user information using TCP microservice communication
    const user = await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_ID, {
        id: oauthToken.userId,
      }),
    ).catch((error) => {
      this.logger.error(`Failed to fetch user by ID: ${error.message}`);
      throw new RpcException({
        statusCode: 500,
        message: 'Internal error communicating with User microservice',
      });
    });

    if (!user) {
      throw new RpcException(OAUTH_ERROR.INVALID_TOKEN);
    }

    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email.split('@')[0];

    return {
      sub: user.id,
      name,
      email: user.email,
      picture: user.avatarUrl || undefined,
    };
  }

  // ================= HELPERS =================

  async verifyTokenScope(accessToken: string, requiredScope: string): Promise<{ userId: string; clientId: string }> {
    if (!accessToken) {
      throw new RpcException(OAUTH_ERROR.INVALID_TOKEN);
    }

    const oauthToken = await this.tokenRepository.findOne({
      where: { accessToken },
    });

    if (!oauthToken || oauthToken.expiresAt.getTime() < Date.now()) {
      throw new RpcException(OAUTH_ERROR.INVALID_TOKEN);
    }

    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(accessToken);
    } catch (err) {
      throw new RpcException(OAUTH_ERROR.INVALID_TOKEN);
    }

    if (!payload.scopes || !payload.scopes.includes(requiredScope)) {
      throw new RpcException({
        statusCode: 403,
        message: `Forbidden: Token is missing required scope '${requiredScope}'`,
      });
    }

    return {
      userId: oauthToken.userId,
      clientId: oauthToken.clientId,
    };
  }

  private mapClientToResponse(client: OAuthClientEntity): IOAuthClientResponse {
    return {
      id: client.id,
      ownerId: client.ownerId,
      name: client.name,
      logoUrl: client.logoUrl,
      clientId: client.clientId,
      redirectUris: client.redirectUris,
      allowedScopes: client.allowedScopes,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };
  }
}
