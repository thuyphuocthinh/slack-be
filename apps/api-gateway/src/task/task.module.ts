import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.TASK_SERVICE, PORT_TCP.TASK_TCP_PORT),
    ]),
    WorkspaceModule,
  ],
  controllers: [TaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
