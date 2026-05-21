import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { VIDEO_CALL_MESSAGE_PATTERN } from '@slack/constants';
import { VideoCallService } from './video-call.service';
import {
  JoinHuddleRequestDto,
  LeaveHuddleRequestDto,
  JoinHuddleResponseDto,
  LeaveHuddleResponseDto,
  HandleWebhookRequestDto,
  WebhookResponseDto,
  StartRecordingRequestDto,
  StartRecordingResponseDto,
  StopRecordingRequestDto,
  StopRecordingResponseDto,
} from './dto/video-call.dto';

@Controller()
export class VideoCallController {
  private readonly logger = new Logger(VideoCallController.name);

  constructor(private readonly videoCallService: VideoCallService) {}

  @MessagePattern(VIDEO_CALL_MESSAGE_PATTERN.JOIN_HUDDLE)
  async joinHuddle(@Payload() data: JoinHuddleRequestDto): Promise<JoinHuddleResponseDto> {
    this.logger.log(`Received JOIN_HUDDLE pattern for user: ${data.userId}, channel: ${data.channelId}`);
    return await this.videoCallService.joinHuddle(data);
  }

  @MessagePattern(VIDEO_CALL_MESSAGE_PATTERN.LEAVE_HUDDLE)
  async leaveHuddle(@Payload() data: LeaveHuddleRequestDto): Promise<LeaveHuddleResponseDto> {
    this.logger.log(`Received LEAVE_HUDDLE pattern for user: ${data.userId}, huddle: ${data.huddleId}`);
    return await this.videoCallService.leaveHuddle(data);
  }

  @MessagePattern(VIDEO_CALL_MESSAGE_PATTERN.HANDLE_WEBHOOK)
  async handleWebhook(@Payload() data: HandleWebhookRequestDto): Promise<WebhookResponseDto> {
    this.logger.log(`Received HANDLE_WEBHOOK pattern`);
    return await this.videoCallService.handleWebhook(data);
  }

  @MessagePattern(VIDEO_CALL_MESSAGE_PATTERN.START_RECORDING)
  async startRecording(@Payload() data: StartRecordingRequestDto): Promise<StartRecordingResponseDto> {
    this.logger.log(`Received START_RECORDING pattern for huddle: ${data.huddleId}`);
    return await this.videoCallService.startRecording(data);
  }

  @MessagePattern(VIDEO_CALL_MESSAGE_PATTERN.STOP_RECORDING)
  async stopRecording(@Payload() data: StopRecordingRequestDto): Promise<StopRecordingResponseDto> {
    this.logger.log(`Received STOP_RECORDING pattern for huddle: ${data.huddleId}`);
    return await this.videoCallService.stopRecording(data);
  }
}
