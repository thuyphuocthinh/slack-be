import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, ORCHESTRATION_MESSAGE_PATTERNS } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { EdgeLoginDto } from './dto/edge-login.dto';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';

@Injectable()
export class OrchestrationService {
  constructor(
    @Inject(NAME_SERVICE_TCP.ORCHESTRATION_SERVICE)
    private readonly orchestrationClient: ClientProxy,
  ) {}

  async edgeLogin(dto: EdgeLoginDto): Promise<{ accessToken: string }> {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.orchestrationClient.send(
            ORCHESTRATION_MESSAGE_PATTERNS.EDGE_RELAY_LOGIN,
            dto,
          ),
        ),
      'edgeLogin',
      'OrchestrationService',
    );
  }
}
