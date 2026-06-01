import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EQueueName, BaseProcessor, EJobName, QueueService, IProcessIncomingWebhookJobData } from '@slack/queue';
import { WebhookAdapterFactory } from '../adapters/webhook-adapter.factory';
import { Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CHANNEL_MESSAGE_PATTERN, NAME_SERVICE_TCP } from '@slack/constants';
import { firstValueFrom } from 'rxjs';

@Processor(EQueueName.INCOMING_WEBHOOK_QUEUE, { concurrency: 10 })
export class CustomWebhookProcessor extends BaseProcessor<IProcessIncomingWebhookJobData, string, EJobName> {
  constructor(
    private readonly queueService: QueueService,
    @Inject(NAME_SERVICE_TCP.CHANNEL_SERVICE)
    private readonly channelClient: ClientProxy,
  ) {
    super();
  }

  async process(job: Job<IProcessIncomingWebhookJobData, string, EJobName>): Promise<string> {
    if (job.name === EJobName.PROCESS_INCOMING_WEBHOOK) {
      this.logger.log(`Processing incoming webhook job: ${job.id}`);
      const { appType, workspaceId, channelId, token, payload, headers } = job.data;

      try {
        // 1. Get the correct adapter
        const adapter = WebhookAdapterFactory.getAdapter(appType);

        // 2. Transform the raw payload into a standard format
        const transformedData = adapter.transform(payload);
        if (!transformedData) {
          this.logger.warn(`Adapter returned null for appType: ${appType}`);
          return 'Ignored';
        }

        // 2.5 Lookup the real webhook UUID using the token
        const webhook = await firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.WEBHOOK_VERIFY, {
            workspaceId,
            channelId,
            token,
          }),
        );

        if (!webhook) {
          throw new Error(`Webhook not found for token: ${token}`);
        }

        // 3. Put it back into the MESSAGE_QUEUE so the standard WebhookProcessor can handle it
        await this.queueService.addJob(EQueueName.MESSAGE_QUEUE, EJobName.PROCESS_WEBHOOK_MESSAGE, {
          channelId,
          workspaceId,
          webhookId: webhook.id, // the real UUID from db
          customName: appType,
          content: transformedData.content || transformedData.text || '',
          attachments: transformedData.attachments || [],
        });

        this.logger.log(`Successfully forwarded incoming webhook for ${appType} to MESSAGE_QUEUE`);
        return 'Success';
      } catch (error) {
        this.logger.error(`Failed to process incoming webhook for ${appType}:`, error.message);
        throw error;
      }
    }

    return 'Ignored';
  }
}
