import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  BaseProcessor,
  EJobName,
  EQueueName,
  IDispatchOutboundWebhookJobData,
} from '@slack/queue';
import { InjectRepository } from '@nestjs/typeorm';
import { AppEntity } from '../entity/app.entity';
import { Repository } from 'typeorm';
import axios from 'axios';
import * as crypto from 'crypto';
import { v4 } from 'uuid';

@Processor(EQueueName.OUTBOUND_WEBHOOK_QUEUE, { concurrency: 5 })
export class OutboundWebhookProcessor extends BaseProcessor<
  IDispatchOutboundWebhookJobData,
  void,
  EJobName
> {
  constructor(
    @InjectRepository(AppEntity)
    private readonly appRepository: Repository<AppEntity>,
  ) {
    super();
  }

  async process(
    job: Job<IDispatchOutboundWebhookJobData, void, EJobName>,
  ): Promise<void> {
    switch (job.name) {
      case EJobName.DISPATCH_OUTBOUND_WEBHOOK: {
        this.logger.debug(`Dispatching webhook for job ${job.id}`);
        try {
          const { appId, eventType, payload } = job.data;
          const app = await this.appRepository.findOne({ where: { id: appId } });

          if (!app) {
            this.logger.warn(`App ${appId} not found, skipping webhook`);
            return;
          }

          if (!app.requestUrl) {
            this.logger.warn(`App ${appId} has no requestUrl, skipping webhook`);
            return;
          }

          const timestamp = Math.floor(Date.now() / 1000).toString();
          const event_id = job.id || v4();

          const payloadObj = {
            type: 'event_callback',
            event_id,
            event_time: Number(timestamp),
            event: { type: eventType, ...payload },
          };
          const payloadStr = JSON.stringify(payloadObj);

          // Slack standard: v0:timestamp:payload
          const sigBaseString = `v0:${timestamp}:${payloadStr}`;

          // sign on payload using signing secret
          // in bot server, they will verify this signature by using signing secret with sha256
          const signature = crypto
            .createHmac('sha256', app.signingSecret)
            .update(sigBaseString)
            .digest('hex');

          const slackSignature = `v0=${signature}`;

          await axios.post(
            app.requestUrl,
            payloadStr,
            {
              headers: {
                'X-Slack-Request-Timestamp': timestamp,
                'X-Slack-Signature': slackSignature,
                'Content-Type': 'application/json',
              },
              timeout: 3000,
            },
          );

          this.logger.debug(`Webhook dispatched successfully to ${app.requestUrl}`);
        } catch (error) {
          if (axios.isAxiosError(error)) {
            this.logger.error(
              `Webhook dispatch failed. URL: ${error.config?.url}, Status: ${error.response?.status}, Error: ${error.message}`
            );
          } else {
            this.logger.error(
              `Failed to dispatch webhook for job ${job.id}: ${error instanceof Error ? error.message : 'Unknown Error'}`,
            );
          }
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
