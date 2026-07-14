import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import {
  NAME_SERVICE_TCP,
  ORCHESTRATION_MESSAGE_PATTERNS,
} from '@slack/constants';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';
import { RegisterDynamicProviderDto } from './dto/register-dynamic-provider.dto';
import { UpdateDynamicProviderDto } from './dto/update-dynamic-provider.dto';

@Injectable()
export class AiProvidersService {
  constructor(
    @Inject(NAME_SERVICE_TCP.ORCHESTRATION_SERVICE)
    private readonly orchestrationClient: ClientProxy,
  ) {}

  async getProviders(userId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        lastValueFrom(
          this.orchestrationClient.send(
            ORCHESTRATION_MESSAGE_PATTERNS.GET_PROVIDERS,
            { userId },
          ),
        ),
      'getProviders',
      'AiProvidersService',
    );
  }

  async connect(userId: string, provider: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        lastValueFrom(
          this.orchestrationClient.send(
            ORCHESTRATION_MESSAGE_PATTERNS.INITIATE_CONNECT,
            {
              userId,
              provider,
            },
          ),
        ),
      'connect',
      'AiProvidersService',
    );
  }

  async submitCredentials(
    userId: string,
    provider: string,
    credentials: Record<string, string>,
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        lastValueFrom(
          this.orchestrationClient.send(
            ORCHESTRATION_MESSAGE_PATTERNS.SUBMIT_CREDENTIALS,
            {
              userId,
              provider,
              credentials,
            },
          ),
        ),
      'submitCredentials',
      'AiProvidersService',
    );
  }

  async disconnect(userId: string, provider: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        lastValueFrom(
          this.orchestrationClient.send(
            ORCHESTRATION_MESSAGE_PATTERNS.DISCONNECT_PROVIDER,
            {
              userId,
              provider,
            },
          ),
        ),
      'disconnect',
      'AiProvidersService',
    );
  }

  // Giai đoạn 3 (HITL) — messageId là message "approval_request" FE đang
  // hiện nút Approve/Reject trên đó.
  async resolveApproval(
    userId: string,
    messageId: string,
    action: 'approve' | 'reject',
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        lastValueFrom(
          this.orchestrationClient.send(
            ORCHESTRATION_MESSAGE_PATTERNS.RESOLVE_APPROVAL,
            {
              userId,
              messageId,
              action,
            },
          ),
        ),
      'resolveApproval',
      'AiProvidersService',
    );
  }

  // messageId = reply messageId của BOT (message đang stream/hiện tool-call
  // timeline), KHÔNG phải messageId user hỏi ban đầu.
  async cancelTurn(userId: string, messageId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        lastValueFrom(
          this.orchestrationClient.send(ORCHESTRATION_MESSAGE_PATTERNS.CANCEL_TURN, {
            userId,
            messageId,
          }),
        ),
      'cancelTurn',
      'AiProvidersService',
    );
  }

  async triggerPrompt(
    userId: string,
    provider: string,
    name: string,
    args: Record<string, string>,
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        lastValueFrom(
          this.orchestrationClient.send(
            ORCHESTRATION_MESSAGE_PATTERNS.TRIGGER_PROMPT,
            {
              userId,
              provider,
              name,
              args,
            },
          ),
        ),
      'triggerPrompt',
      'AiProvidersService',
    );
  }

  async registerDynamicProvider(
    userId: string,
    dto: RegisterDynamicProviderDto,
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        lastValueFrom(
          this.orchestrationClient.send(
            ORCHESTRATION_MESSAGE_PATTERNS.REGISTER_DYNAMIC_PROVIDER,
            { userId, ...dto },
          ),
        ),
      'registerDynamicProvider',
      'AiProvidersService',
    );
  }

  async updateDynamicProvider(
    userId: string,
    providerId: string,
    dto: UpdateDynamicProviderDto,
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        lastValueFrom(
          this.orchestrationClient.send(
            ORCHESTRATION_MESSAGE_PATTERNS.UPDATE_DYNAMIC_PROVIDER,
            { userId, providerId, ...dto },
          ),
        ),
      'updateDynamicProvider',
      'AiProvidersService',
    );
  }

  async deleteDynamicProvider(userId: string, providerId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        lastValueFrom(
          this.orchestrationClient.send(
            ORCHESTRATION_MESSAGE_PATTERNS.DELETE_DYNAMIC_PROVIDER,
            { userId, providerId },
          ),
        ),
      'deleteDynamicProvider',
      'AiProvidersService',
    );
  }
}
