import { Module } from '@nestjs/common';
import { ChannelController } from './channel.controller';
import { ChannelService } from './service/channel.service';
import { DatabaseModule } from '@slack/database';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelEntity } from './entity/channel.entity';
import { ChannelMemberEntity } from './entity/channel_member.entity';
import { IncomingWebhookEntity } from './entity/incoming-webhook.entity';
import { CachedModule } from '@slack/cached';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { QueueModule, EQueueName } from '@slack/queue';
import { ChannelMemberService } from './service/channel-member.service';
import { ChannelProcessor } from './processors/channel.processor';
import { WebhookService } from './service/webhook.service';

@Module({
  imports: [
    DatabaseModule,
    CachedModule.forRoot(),
    TypeOrmModule.forFeature([ChannelEntity, ChannelMemberEntity, IncomingWebhookEntity]),
    QueueModule.forRoot(),
    QueueModule.forFeature([
      EQueueName.CHANNEL_QUEUE,
      EQueueName.SOCKET_QUEUE,
      EQueueName.AUDIT_QUEUE,
    ]),

    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.WORKSPACE_SERVICE, PORT_TCP.WORKSPACE_TCP_PORT),
      getMicroserviceClientConfig(NAME_SERVICE_TCP.USER_SERVICE, PORT_TCP.USER_TCP_PORT),
    ]),
  ],
  controllers: [ChannelController],
  providers: [ChannelService, ChannelMemberService, ChannelProcessor, WebhookService],
})
export class ChannelModule {}
