import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { AiService } from './ai.service';
import { INTEGRATIONS_MESSAGE_PATTERNS } from '@slack/constants';
import { type IAiChatRequest, IAiChatResponse } from './types/ai.type';

@Controller()
export class AiController {
  constructor(private readonly aiService: AiService) { }

  @MessagePattern(INTEGRATIONS_MESSAGE_PATTERNS.AI_CHAT)
  handleAiChat(@Payload() data: IAiChatRequest): Observable<IAiChatResponse> {
    return this.aiService.generateResponse(data);
  }
}
