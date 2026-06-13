import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskController } from './task.controller';
import { TaskService } from './services/task.service';
import { BoardService } from './services/board.service';
import { GroupService } from './services/group.service';
import { LabelService } from './services/label.service';
import { TaskBoardEntity } from './entity/task_board.entity';
import { TaskGroupEntity } from './entity/task_group.entity';
import { TaskEntity } from './entity/task.entity';
import { LabelEntity } from './entity/label.entity';
import { ChecklistEntity } from './entity/checklist.entity';
import { ChecklistItemEntity } from './entity/checklist_item.entity';
import { BoardMemberEntity } from './entity/board_member.entity';
import { TaskMemberEntity } from './entity/task_member.entity';
import { DatabaseModule } from '@slack/database';
import { CachedModule } from '@slack/cached';
import { EQueueName, QueueModule } from '@slack/queue';

import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { ChecklistService } from './services/checklist.service';
import { TaskAttachmentEntity } from './entity/task_attachment.entity';
import { TaskProcessor } from './processors/task.processor';
import { TaskCommonService } from './services/task-common.service';

@Module({
  imports: [
    DatabaseModule,
    CachedModule.forRoot(),
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.TASK_QUEUE, EQueueName.AUDIT_QUEUE]),

    TypeOrmModule.forFeature([
      TaskBoardEntity,
      TaskGroupEntity,
      TaskEntity,
      LabelEntity,
      ChecklistEntity,
      ChecklistItemEntity,
      BoardMemberEntity,
      TaskMemberEntity,
      TaskAttachmentEntity,
    ]),
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.WORKSPACE_SERVICE, PORT_TCP.WORKSPACE_TCP_PORT),
      getMicroserviceClientConfig(NAME_SERVICE_TCP.NOTIFICATION_SERVICE, PORT_TCP.NOTIFICATION_TCP_PORT),
    ]),
  ],
  controllers: [TaskController],
  providers: [
    TaskService,
    BoardService,
    GroupService,
    LabelService,
    ChecklistService,
    TaskCommonService,
    TaskProcessor,
  ],
})
export class TaskModule {}
