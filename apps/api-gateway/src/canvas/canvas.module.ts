import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { CanvasController } from './canvas.controller'
import { CanvasService } from './canvas.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.CANVAS_SERVICE,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: PORT_TCP.CANVAS_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [CanvasController],
  providers: [CanvasService],
  exports: [CanvasService],
})
export class CanvasModule { }
