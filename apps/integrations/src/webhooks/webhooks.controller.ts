import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { WebhooksService } from './webhooks.service';
import { INTEGRATIONS_MESSAGE_PATTERNS } from '@slack/constants';

@Controller()
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @MessagePattern(INTEGRATIONS_MESSAGE_PATTERNS.QUEUE_INCOMING_WEBHOOK)
  async handleWebhook(@Payload() data: {
    appType: string;
    workspaceId: string;
    channelId: string;
    token: string;
    headers: Record<string, string>;
    payload: Record<string, unknown>;
  }) {
    // 1. Put into queue
    await this.webhooksService.queueWebhook(
      data.appType,
      data.workspaceId,
      data.channelId,
      data.token,
      data.headers,
      data.payload,
    );
    
    // 2. Return 200 equivalent
    return { success: true, queued: true };
  }
}
