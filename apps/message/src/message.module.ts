import { Module } from '@nestjs/common';
import { MessageController } from './message.controller';
import { MessageService } from './service/message.service';
import { DatabaseModule } from '@slack/database';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageEntity } from './entity/message.entity';
import { MessageMentionEntity } from './entity/message_mention.entity';
import { MessageReactionEntity } from './entity/message_reaction.entity';
import { MessageAttachmentEntity } from './entity/message_attachment.entity';
import { CachedModule } from '@slack/cached';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { ThreadService } from './service/thread.service';
import { MessageAttachmentService } from './service/message-attachment.service';
import { EQueueName, QueueModule } from '@slack/queue';
import { DefaultWebhookProcessor } from './processor/default-webhook.processor';
import { CustomWebhookProcessor } from './processor/custom-webhook.processor';

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
    ]),

    TypeOrmModule.forFeature([
      MessageEntity,
      MessageMentionEntity,
      MessageReactionEntity,
      MessageAttachmentEntity,
    ]),
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.CHANNEL_SERVICE,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: PORT_TCP.CHANNEL_TCP_PORT,
        },
      },
      {
        name: NAME_SERVICE_TCP.USER_SERVICE,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: PORT_TCP.USER_TCP_PORT,
        },
      },
      {
        name: NAME_SERVICE_TCP.NOTIFICATION_SERVICE,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: PORT_TCP.NOTIFICATION_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [MessageController],
  providers: [MessageService, ThreadService, MessageAttachmentService, DefaultWebhookProcessor, CustomWebhookProcessor],
})
export class MessageModule { }
