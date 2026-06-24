import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { INTEGRATIONS_MESSAGE_PATTERNS, NAME_SERVICE_TCP } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';

@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(NAME_SERVICE_TCP.INTEGRATIONS_SERVICE)
    private readonly integrationsClient: ClientProxy,
  ) {}

  async getMyConnections(userId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.integrationsClient.send(INTEGRATIONS_MESSAGE_PATTERNS.GET_MY_CONNECTIONS, { userId }),
        ),
      'getMyConnections',
      'IntegrationsService',
    );
  }

  async generateAuthUrl(
    userId: string, 
    workspaceId: string, 
    provider: string,
    scopes?: string[],
    targetType?: string,
    returnUrl?: string
  ) {
    const res = await MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.integrationsClient.send(INTEGRATIONS_MESSAGE_PATTERNS.AUTH_GENERATE_URL, {
            userId,
            workspaceId,
            provider,
            scopes,
            targetType,
            returnUrl
          }),
        ),
      'generateAuthUrl',
      'IntegrationsService',
    );
    return res?.authUrl || res;
  }

  async handleCallback(provider: string, code: string, state: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.integrationsClient.send(INTEGRATIONS_MESSAGE_PATTERNS.AUTH_HANDLE_CALLBACK, {
            provider,
            code,
            state,
          }),
        ),
      'handleCallback',
      'IntegrationsService',
    );
  }

  async revokeConnection(userId: string, provider: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.integrationsClient.send(INTEGRATIONS_MESSAGE_PATTERNS.REVOKE_CONNECTION, {
            userId,
            provider,
          }),
        ),
      'revokeConnection',
      'IntegrationsService',
    );
  }

  async revokeConnectionById(userId: string, connectionId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.integrationsClient.send(INTEGRATIONS_MESSAGE_PATTERNS.REVOKE_CONNECTION, {
            userId,
            connectionId,
          }),
        ),
      'revokeConnectionById',
      'IntegrationsService',
    );
  }

  async saveApiKey(userId: string, workspaceId: string, provider: string, apiKey: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.integrationsClient.send(INTEGRATIONS_MESSAGE_PATTERNS.SAVE_API_KEY, {
            userId,
            workspaceId,
            provider,
            apiKey,
          }),
        ),
      'saveApiKey',
      'IntegrationsService',
    );
  }
}
