import { Injectable, Logger } from '@nestjs/common';
import { QueueService } from '@slack/queue';
import { EQueueName, EJobName } from '@slack/queue';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly queueService: QueueService) {}

  async queueWebhook(
    appType: string,
    workspaceId: string,
    channelId: string,
    token: string,
    headers: Record<string, string>,
    payload: Record<string, unknown>,
  ) {
    try {
      this.logger.log(`Queuing incoming webhook for appType: ${appType}`);

      await this.queueService.addJob(
        EQueueName.INCOMING_WEBHOOK_QUEUE,
        EJobName.PROCESS_INCOMING_WEBHOOK,
        {
          appType,
          workspaceId,
          channelId,
          token,
          headers,
          payload,
        },
      );
      this.logger.log(`Successfully queued webhook for appType: ${appType}`);
    } catch (error) {
      this.logger.error(`Failed to queue webhook for appType: ${appType}`, error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }
}
