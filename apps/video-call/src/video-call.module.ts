import { Module } from '@nestjs/common';
import { VideoCallController } from './video-call.controller';
import { VideoCallService } from './video-call.service';

@Module({
  imports: [],
  controllers: [VideoCallController],
  providers: [VideoCallService],
})
export class VideoCallModule {}
