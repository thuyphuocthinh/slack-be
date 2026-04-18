import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.WORKSPACE_SERVICE,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: PORT_TCP.WORKSPACE_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
