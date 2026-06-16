import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { OAuthService } from './oauth.service';
import { OAUTH_MESSAGE_PATTERNS } from '@slack/constants';
import {
  ICreateOAuthClientDto,
  IUpdateOAuthClientDto,
  IGetOAuthAuthorizeDetailsDto,
  IOAuthApproveConsentDto,
  IOAuthTokenExchangeDto,
  IOAuthRevokeTokenDto,
} from './types/oauth.interface';

@Controller()
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  // ================= DEVELOPER CONSOLE =================

  @MessagePattern(OAUTH_MESSAGE_PATTERNS.CREATE_CLIENT)
  createClient(@Payload() payload: { ownerId: string; data: ICreateOAuthClientDto }) {
    return this.oauthService.createClient(payload.ownerId, payload.data);
  }

  @MessagePattern(OAUTH_MESSAGE_PATTERNS.GET_CLIENTS)
  getClients(@Payload() payload: { ownerId: string }) {
    return this.oauthService.getClients(payload.ownerId);
  }

  @MessagePattern(OAUTH_MESSAGE_PATTERNS.GET_CLIENT_DETAILS)
  getClientDetails(@Payload() payload: { ownerId: string; id: string }) {
    return this.oauthService.getClientDetails(payload.ownerId, payload.id);
  }

  @MessagePattern(OAUTH_MESSAGE_PATTERNS.UPDATE_CLIENT)
  updateClient(@Payload() payload: { ownerId: string; id: string; data: IUpdateOAuthClientDto }) {
    return this.oauthService.updateClient(payload.ownerId, payload.id, payload.data);
  }

  @MessagePattern(OAUTH_MESSAGE_PATTERNS.REGENERATE_CLIENT_SECRET)
  regenerateClientSecret(@Payload() payload: { ownerId: string; id: string }) {
    return this.oauthService.regenerateClientSecret(payload.ownerId, payload.id);
  }

  @MessagePattern(OAUTH_MESSAGE_PATTERNS.DELETE_CLIENT)
  deleteClient(@Payload() payload: { ownerId: string; id: string }) {
    return this.oauthService.deleteClient(payload.ownerId, payload.id);
  }

  // ================= OAUTH PROVIDER FLOW =================

  @MessagePattern(OAUTH_MESSAGE_PATTERNS.GET_AUTHORIZE_DETAILS)
  getAuthorizeDetails(@Payload() payload: { data: IGetOAuthAuthorizeDetailsDto }) {
    return this.oauthService.getAuthorizeDetails(payload.data);
  }

  @MessagePattern(OAUTH_MESSAGE_PATTERNS.APPROVE_CONSENT)
  approveConsent(@Payload() payload: { userId: string; data: IOAuthApproveConsentDto }) {
    return this.oauthService.approveConsent(payload.userId, payload.data);
  }

  @MessagePattern(OAUTH_MESSAGE_PATTERNS.EXCHANGE_TOKEN)
  exchangeToken(@Payload() payload: { data: IOAuthTokenExchangeDto }) {
    return this.oauthService.exchangeToken(payload.data);
  }

  @MessagePattern(OAUTH_MESSAGE_PATTERNS.GET_USERINFO)
  getUserInfo(@Payload() payload: { accessToken: string }) {
    return this.oauthService.getUserInfo(payload.accessToken);
  }

  @MessagePattern(OAUTH_MESSAGE_PATTERNS.VERIFY_TOKEN_SCOPE)
  verifyTokenScope(@Payload() payload: { accessToken: string; requiredScope: string }) {
    return this.oauthService.verifyTokenScope(payload.accessToken, payload.requiredScope);
  }

  @MessagePattern(OAUTH_MESSAGE_PATTERNS.REVOKE_TOKEN)
  revokeToken(@Payload() payload: { data: IOAuthRevokeTokenDto }) {
    return this.oauthService.revokeToken(payload.data);
  }

  @MessagePattern(OAUTH_MESSAGE_PATTERNS.GET_AUTHORIZED_CLIENTS)
  getAuthorizedClients(@Payload() payload: { userId: string }) {
    return this.oauthService.getAuthorizedClients(payload.userId);
  }

  @MessagePattern(OAUTH_MESSAGE_PATTERNS.REVOKE_AUTHORIZED_CLIENT)
  revokeAuthorizedClient(@Payload() payload: { userId: string; clientId: string }) {
    return this.oauthService.revokeAuthorizedClient(payload.userId, payload.clientId);
  }
}
