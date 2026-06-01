import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EQueueName, BaseProcessor, EJobName, QueueService, IProcessIncomingWebhookJobData } from '@slack/queue';
import { WebhookAdapterFactory } from '../adapters/webhook-adapter.factory';

@Processor(EQueueName.INCOMING_WEBHOOK_QUEUE, { concurrency: 10 })
export class CustomWebhookProcessor extends BaseProcessor<IProcessIncomingWebhookJobData, string, EJobName> {
  constructor(private readonly queueService: QueueService) {
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

        // 3. Put it back into the MESSAGE_QUEUE so the standard WebhookProcessor can handle it
        await this.queueService.addJob(EQueueName.MESSAGE_QUEUE, EJobName.PROCESS_WEBHOOK_MESSAGE, {
          channelId,
          workspaceId,
          webhookId: token, // Assuming token represents the webhook ID here, or you may need to look it up
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
