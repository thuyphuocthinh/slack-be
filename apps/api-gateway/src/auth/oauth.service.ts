import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { OAUTH_MESSAGE_PATTERNS, NAME_SERVICE_TCP } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';
import {
  CreateOAuthClientDto,
  UpdateOAuthClientDto,
  GetOAuthAuthorizeDetailsDto,
  OAuthApproveConsentDto,
  OAuthTokenExchangeDto,
} from './dto/oauth.dto';

@Injectable()
export class OAuthService {
  constructor(
    @Inject(NAME_SERVICE_TCP.AUTH_SERVICE)
    private readonly authClient: ClientProxy,
  ) {}

  // ================= DEVELOPER CONSOLE =================

  async createClient(ownerId: string, data: CreateOAuthClientDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(OAUTH_MESSAGE_PATTERNS.CREATE_CLIENT, {
            ownerId,
            data,
          }),
        ),
      'createClient',
      'OAuthService',
    );
  }

  async getClients(ownerId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(OAUTH_MESSAGE_PATTERNS.GET_CLIENTS, {
            ownerId,
          }),
        ),
      'getClients',
      'OAuthService',
    );
  }

  async getClientDetails(ownerId: string, id: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(OAUTH_MESSAGE_PATTERNS.GET_CLIENT_DETAILS, {
            ownerId,
            id,
          }),
        ),
      'getClientDetails',
      'OAuthService',
    );
  }

  async updateClient(ownerId: string, id: string, data: UpdateOAuthClientDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(OAUTH_MESSAGE_PATTERNS.UPDATE_CLIENT, {
            ownerId,
            id,
            data,
          }),
        ),
      'updateClient',
      'OAuthService',
    );
  }

  async regenerateClientSecret(ownerId: string, id: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(OAUTH_MESSAGE_PATTERNS.REGENERATE_CLIENT_SECRET, {
            ownerId,
            id,
          }),
        ),
      'regenerateClientSecret',
      'OAuthService',
    );
  }

  async deleteClient(ownerId: string, id: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(OAUTH_MESSAGE_PATTERNS.DELETE_CLIENT, {
            ownerId,
            id,
          }),
        ),
      'deleteClient',
      'OAuthService',
    );
  }

  // ================= OAUTH PROVIDER FLOW =================

  async getAuthorizeDetails(data: GetOAuthAuthorizeDetailsDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(OAUTH_MESSAGE_PATTERNS.GET_AUTHORIZE_DETAILS, {
            data,
          }),
        ),
      'getAuthorizeDetails',
      'OAuthService',
    );
  }

  async approveConsent(userId: string, data: OAuthApproveConsentDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(OAUTH_MESSAGE_PATTERNS.APPROVE_CONSENT, {
            userId,
            data,
          }),
        ),
      'approveConsent',
      'OAuthService',
    );
  }

  async exchangeToken(data: OAuthTokenExchangeDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(OAUTH_MESSAGE_PATTERNS.EXCHANGE_TOKEN, {
            data,
          }),
        ),
      'exchangeToken',
      'OAuthService',
    );
  }

  async getUserInfo(accessToken: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(OAUTH_MESSAGE_PATTERNS.GET_USERINFO, {
            accessToken,
          }),
        ),
      'getUserInfo',
      'OAuthService',
    );
  }

  async verifyTokenScope(accessToken: string, requiredScope: string): Promise<{ userId: string; clientId: string }> {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.authClient.send(OAUTH_MESSAGE_PATTERNS.VERIFY_TOKEN_SCOPE, {
            accessToken,
            requiredScope,
          }),
        ),
      'verifyTokenScope',
      'OAuthService',
    );
  }
}
