import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.TASK_SERVICE,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: PORT_TCP.TASK_TCP_PORT,
        },
      },
    ]),
    WorkspaceModule,
  ],
  controllers: [TaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
