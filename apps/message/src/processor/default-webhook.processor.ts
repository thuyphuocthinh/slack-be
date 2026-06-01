import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  BaseProcessor,
  EJobName,
  EQueueName,
  IProcessWebhookMessageJobData,
} from '@slack/queue';
import { MessageService } from '../service/message.service';

@Processor(EQueueName.MESSAGE_QUEUE, { concurrency: 5 })
export class DefaultWebhookProcessor extends BaseProcessor<
  IProcessWebhookMessageJobData,
  void,
  EJobName
> {
  constructor(private readonly messageService: MessageService) {
    super();
  }

  async process(
    job: Job<IProcessWebhookMessageJobData, void, EJobName>,
  ): Promise<void> {
    switch (job.name) {
      case EJobName.PROCESS_WEBHOOK_MESSAGE: {
        this.logger.debug(`Processing webhook message from job ${job.id}`);
        try {
          await this.messageService.createWebhookMessage(job.data);
          this.logger.debug(
            `Webhook message created successfully for job ${job.id}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to process webhook message for job ${job.id}: ${error.message}`,
            error.stack,
          );
          throw error;
        }
        break;
      }
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        throw new Error(`Job name ${job.name} is not supported`);
    }
  }
}
