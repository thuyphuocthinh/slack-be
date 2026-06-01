import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { QueueModule, EQueueName } from '@slack/queue';

@Module({
  imports: [
    QueueModule.forFeature([EQueueName.INCOMING_WEBHOOK_QUEUE]),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
