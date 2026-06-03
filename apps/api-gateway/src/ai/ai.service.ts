import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { INTEGRATIONS_MESSAGE_PATTERNS, NAME_SERVICE_TCP } from '@slack/constants';
import { IAiChatRequest, IAiChatResponse } from './types/ai.type';
import { Observable } from 'rxjs';

@Injectable()
export class AiService {
  constructor(
    @Inject(NAME_SERVICE_TCP.INTEGRATIONS_SERVICE) private readonly integrationsClient: ClientProxy,
  ) { }

  chat(payload: IAiChatRequest): Observable<IAiChatResponse> {
    return this.integrationsClient.send<IAiChatResponse, IAiChatRequest>(
      INTEGRATIONS_MESSAGE_PATTERNS.AI_CHAT, 
      payload
    );
  }
}
