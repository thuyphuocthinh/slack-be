import { Body, Controller, HttpCode, Inject, Logger, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { CHANNEL_MESSAGE_PATTERN, NAME_SERVICE_TCP } from '@slack/constants';
import { EJobName, EQueueName, QueueService } from '@slack/queue';
import { RateLimit } from '../common/guards/rate-limit.decorator';
import { Public } from '@slack/common';
import { WebhookPayloadDto } from './dto/webhook-payload.dto';

@ApiTags('Incoming Webhooks')
@Controller('services/hooks')
export class WebhookReceiverController {
  private readonly logger = new Logger(WebhookReceiverController.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.CHANNEL_SERVICE)
    private readonly channelClient: ClientProxy,
    private readonly queueService: QueueService,
  ) { }

  @Post(':workspaceId/:channelId/:token')
  @Public()
  @RateLimit({ limit: 1, window: 1000 }) // 1 request per second
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive incoming webhook payload from external services' })
  @ApiResponse({ status: 200, description: 'Payload received and queued successfully' })
  @ApiResponse({ status: 401, description: 'Invalid webhook token or not found' })
  async receiveWebhook(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Param('token') token: string,
    @Body() payload: WebhookPayloadDto,
  ) {
    try {
      // 1. Verify Webhook using TCP
      const webhook = await firstValueFrom(
        this.channelClient.send(CHANNEL_MESSAGE_PATTERN.WEBHOOK_VERIFY, {
          workspaceId,
          channelId,
          token,
        }),
      );

      if (!webhook) {
        throw new UnauthorizedException('Invalid webhook');
      }

      // 2. Format message payload (support overriding from external payload if permitted, otherwise use webhook defaults)
      const messageContent = payload.text || payload.content || JSON.stringify(payload);
      // NOTE: In advanced version, we might allow payload to override name/avatar
      const customName = payload.username || webhook.name;
      const customAvatarUrl = payload.icon_url || webhook.avatarUrl;

      // 3. Push job to MESSAGE_QUEUE for processing
      await this.queueService.addJob(EQueueName.MESSAGE_QUEUE, EJobName.PROCESS_WEBHOOK_MESSAGE, {
        channelId: webhook.channelId,
        workspaceId: webhook.workspaceId,
        webhookId: webhook.id,
        customName,
        customAvatarUrl,
        content: messageContent,
        attachments: payload.attachments || [], // slack format attachments
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Webhook verification failed for token ${token}:`, error.message);
      throw new UnauthorizedException('Invalid webhook or service unavailable');
    }
  }
}
