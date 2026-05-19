import { Controller, Get } from '@nestjs/common';
import { VideoCallService } from './video-call.service';

@Controller()
export class VideoCallController {
  constructor(private readonly videoCallService: VideoCallService) {}

  @Get()
  getHello(): string {
    return this.videoCallService.getHello();
  }
}
