import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { VideoCallController } from './video-call.controller';
import { VideoCallService } from './video-call.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    BillingModule,
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.VIDEO_CALL_SERVICE, PORT_TCP.VIDEO_CALL_TCP_PORT),
    ]),
  ],
  controllers: [VideoCallController],
  providers: [VideoCallService],
  exports: [VideoCallService],
})
export class VideoCallModule {}
