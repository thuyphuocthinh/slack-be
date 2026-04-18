import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspaceEntity } from './entity/workspace.entity';
import { WorkspaceMemberEntity } from './entity/workspace_member.entity';
import { WorkspaceInviteEntity } from './entity/workspace_invite.entity';
import { WorkspaceLinkEntity } from './entity/workspace_link.entity';
import { DatabaseModule } from '@slack/database';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      WorkspaceEntity,
      WorkspaceMemberEntity,
      WorkspaceInviteEntity,
      WorkspaceLinkEntity,
    ]),
    ClientsModule.register([
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
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
})
export class WorkspaceModule {}
