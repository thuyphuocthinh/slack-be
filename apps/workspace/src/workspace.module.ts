import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './services/workspace.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspaceEntity } from './entity/workspace.entity';
import { WorkspaceMemberEntity } from './entity/workspace_member.entity';
import { WorkspaceInviteEntity } from './entity/workspace_invite.entity';
import { WorkspaceLinkEntity } from './entity/workspace_link.entity';
import { AppEntity } from './entity/app.entity';
import { AppEventSubscriptionEntity } from './entity/app-event-subscription.entity';
import { DatabaseModule } from '@slack/database';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { CachedModule } from '@slack/cached';
import { WorkspaceCommonService } from './services/workspace-common.service';
import { WorkspaceMemberService } from './services/workspace-member.service';
import { WorkspaceInviteService } from './services/workspace-invite.service';
import { WorkspaceLinkService } from './services/workspace-link.service';
import { AppService } from './services/app.service';
import { EQueueName, QueueModule } from '@slack/queue';
import { OutboundWebhookProcessor } from './processor/outbound-webhook.processor';

@Module({
  imports: [
    DatabaseModule,
    CachedModule.forRoot(),
    QueueModule.forRoot(),
    QueueModule.forFeature([
      EQueueName.EMAIL_QUEUE, 
      EQueueName.AUDIT_QUEUE,
      EQueueName.OUTBOUND_WEBHOOK_QUEUE,
    ]),

    TypeOrmModule.forFeature([
      WorkspaceEntity,
      WorkspaceMemberEntity,
      WorkspaceInviteEntity,
      WorkspaceLinkEntity,
      AppEntity,
      AppEventSubscriptionEntity,
    ]),
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.NOTIFICATION_SERVICE, PORT_TCP.NOTIFICATION_TCP_PORT),
      getMicroserviceClientConfig(NAME_SERVICE_TCP.USER_SERVICE, PORT_TCP.USER_TCP_PORT),
      getMicroserviceClientConfig(NAME_SERVICE_TCP.CHANNEL_SERVICE, PORT_TCP.CHANNEL_TCP_PORT),
    ]),
  ],
  controllers: [WorkspaceController],
  providers: [
    WorkspaceService,
    WorkspaceCommonService,
    WorkspaceMemberService,
    WorkspaceInviteService,
    WorkspaceLinkService,
    AppService,
    OutboundWebhookProcessor,
  ],
})
export class WorkspaceModule {}
