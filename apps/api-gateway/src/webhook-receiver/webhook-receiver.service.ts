import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { CHANNEL_MESSAGE_PATTERN, NAME_SERVICE_TCP, WORKSPACE_MESSAGE_PATTERNS } from '@slack/constants';
import { EJobName, EQueueName, QueueService } from '@slack/queue';
import { WebhookPayloadDto } from './dto/webhook-payload.dto';

@Injectable()
export class WebhookReceiverService {
  private readonly logger = new Logger(WebhookReceiverService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.CHANNEL_SERVICE)
    private readonly channelClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.WORKSPACE_SERVICE)
    private readonly workspaceClient: ClientProxy,
    private readonly queueService: QueueService,
  ) { }

  async processWebhook(workspaceId: string, channelId: string, token: string, payload: WebhookPayloadDto) {
    try {
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

      const messageContent = payload.text || payload.content || JSON.stringify(payload);
      const customName = payload.username || webhook.name;
      const customAvatarUrl = payload.icon_url || webhook.avatarUrl;

      await this.queueService.addJob(EQueueName.MESSAGE_QUEUE, EJobName.PROCESS_WEBHOOK_MESSAGE, {
        channelId: webhook.channelId,
        workspaceId: webhook.workspaceId,
        webhookId: webhook.id,
        customName,
        customAvatarUrl,
        content: messageContent,
        attachments: payload.attachments || [],
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Webhook verification failed for token ${token}:`, error.message);
      throw new UnauthorizedException('Invalid webhook or service unavailable');
    }
  }

  async processCommandResponse(token: string, payload: WebhookPayloadDto) {
    try {
      const commandData = await firstValueFrom(
        this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.VERIFY_COMMAND_RESPONSE, token),
      );

      if (!commandData) {
        throw new UnauthorizedException('Invalid or expired response token');
      }

      const messageContent = payload.text || payload.content || JSON.stringify(payload);

      await this.queueService.addJob(EQueueName.MESSAGE_QUEUE, EJobName.PROCESS_WEBHOOK_MESSAGE, {
        channelId: commandData.channelId,
        workspaceId: commandData.workspaceId,
        webhookId: commandData.appId,
        customName: payload.username || commandData.appName,
        customAvatarUrl: payload.icon_url || commandData.appAvatarUrl,
        content: messageContent,
        attachments: payload.attachments || [],
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Command response failed for token ${token}:`, error.message);
      throw new UnauthorizedException('Invalid token or service unavailable');
    }
  }
}
