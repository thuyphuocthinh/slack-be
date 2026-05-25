import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { VideoCallController } from './video-call.controller';
import { VideoCallService } from './video-call.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.VIDEO_CALL_SERVICE,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: PORT_TCP.VIDEO_CALL_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [VideoCallController],
  providers: [VideoCallService],
  exports: [VideoCallService],
})
export class VideoCallModule {}
