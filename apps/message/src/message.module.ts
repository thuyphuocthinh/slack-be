import { Module } from '@nestjs/common';
import { MessageController } from './message.controller';
import { MessageService } from './service/message.service';
import { DatabaseModule } from '@slack/database';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageEntity } from './entity/message.entity';
import { MessageMentionEntity } from './entity/message_mention.entity';
import { MessageReactionEntity } from './entity/message_reaction.entity';
import { MessageFeedbackEntity } from './entity/message_feedback.entity';
import { MessageAttachmentEntity } from './entity/message_attachment.entity';
import { LinkPreviewEntity } from './entity/link-preview.entity';
import { CachedModule } from '@slack/cached';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { ThreadService } from './service/thread.service';
import { MessageAttachmentService } from './service/message-attachment.service';
import { EQueueName, QueueModule } from '@slack/queue';
import { DefaultWebhookProcessor } from './processor/default-webhook.processor';
import { CustomWebhookProcessor } from './processor/custom-webhook.processor';
import { LinkScraperService } from './service/link-scraper.service';
import { LinkPreviewProcessor } from './processor/link-preview.processor';

@Module({
  imports: [
    DatabaseModule,
    CachedModule.forRoot(),
    QueueModule.forRoot(),
    QueueModule.forFeature([
      EQueueName.SOCKET_QUEUE,
      EQueueName.NOTIFICATION_QUEUE,
      EQueueName.CHANNEL_QUEUE,
      EQueueName.RESOURCE_QUEUE,
      EQueueName.AUDIT_QUEUE,
      EQueueName.OUTBOUND_WEBHOOK_QUEUE,
      EQueueName.INCOMING_WEBHOOK_QUEUE,
      EQueueName.MESSAGE_QUEUE,
      EQueueName.LINK_PREVIEW_QUEUE,
      EQueueName.AI_ORCHESTRATION_QUEUE,
    ]),

    TypeOrmModule.forFeature([
      MessageEntity,
      MessageMentionEntity,
      MessageReactionEntity,
      MessageFeedbackEntity,
      MessageAttachmentEntity,
      LinkPreviewEntity,
    ]),
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(
        NAME_SERVICE_TCP.CHANNEL_SERVICE,
        PORT_TCP.CHANNEL_TCP_PORT,
      ),
      getMicroserviceClientConfig(
        NAME_SERVICE_TCP.USER_SERVICE,
        PORT_TCP.USER_TCP_PORT,
      ),
      getMicroserviceClientConfig(
        NAME_SERVICE_TCP.NOTIFICATION_SERVICE,
        PORT_TCP.NOTIFICATION_TCP_PORT,
      ),
    ]),
  ],
  controllers: [MessageController],
  providers: [
    MessageService,
    ThreadService,
    MessageAttachmentService,
    DefaultWebhookProcessor,
    CustomWebhookProcessor,
    LinkScraperService,
    LinkPreviewProcessor,
  ],
})
export class MessageModule {}
