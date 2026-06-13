import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { CanvasController } from './canvas.controller'
import { CanvasService } from './canvas.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.CANVAS_SERVICE, PORT_TCP.CANVAS_TCP_PORT),
    ]),
  ],
  controllers: [CanvasController],
  providers: [CanvasService],
  exports: [CanvasService],
})
export class CanvasModule { }
