import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, VIDEO_CALL_MESSAGE_PATTERN } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';
import {
  JoinHuddleRequestDto,
  LeaveHuddleRequestDto,
  HandleWebhookRequestDto,
  StartRecordingRequestDto,
  StopRecordingRequestDto,
  GetRecordingsQueryDto,
} from './dto/video-call-request.dto';
import {
  JoinHuddleResponseDto,
  LeaveHuddleResponseDto,
  WebhookResponseDto,
  StartRecordingResponseDto,
  StopRecordingResponseDto,
  HuddleRecordingsResponseDto,
} from './dto/video-call-response.dto';

@Injectable()
export class VideoCallService {
  private readonly logger = new Logger(VideoCallService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.VIDEO_CALL_SERVICE)
    private readonly videoCallClient: ClientProxy,
  ) {}

  async joinHuddle(dto: JoinHuddleRequestDto): Promise<JoinHuddleResponseDto> {
    this.logger.log(
      `Forwarding join huddle request to video-call microservice: user ${dto.userId}, channel ${dto.channelId}`,
    );
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.videoCallClient.send<JoinHuddleResponseDto>(
            VIDEO_CALL_MESSAGE_PATTERN.JOIN_HUDDLE,
            dto,
          ),
        ),
      'joinHuddle',
      'VideoCallService',
    );
  }

  async leaveHuddle(
    dto: LeaveHuddleRequestDto,
  ): Promise<LeaveHuddleResponseDto> {
    this.logger.log(
      `Forwarding leave huddle request to video-call microservice: user ${dto.userId}, huddle ${dto.huddleId}`,
    );
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.videoCallClient.send<LeaveHuddleResponseDto>(
            VIDEO_CALL_MESSAGE_PATTERN.LEAVE_HUDDLE,
            dto,
          ),
        ),
      'leaveHuddle',
      'VideoCallService',
    );
  }

  async handleWebhook(
    dto: HandleWebhookRequestDto,
  ): Promise<WebhookResponseDto> {
    this.logger.log(`Forwarding LiveKit webhook to video-call microservice`);
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.videoCallClient.send<WebhookResponseDto>(
            VIDEO_CALL_MESSAGE_PATTERN.HANDLE_WEBHOOK,
            dto,
          ),
        ),
      'handleWebhook',
      'VideoCallService',
    );
  }

  async startRecording(
    dto: StartRecordingRequestDto,
  ): Promise<StartRecordingResponseDto> {
    this.logger.log(
      `Forwarding start recording request to video-call microservice for huddle ${dto.huddleId}`,
    );
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.videoCallClient.send<StartRecordingResponseDto>(
            VIDEO_CALL_MESSAGE_PATTERN.START_RECORDING,
            dto,
          ),
        ),
      'startRecording',
      'VideoCallService',
    );
  }

  async stopRecording(
    dto: StopRecordingRequestDto,
  ): Promise<StopRecordingResponseDto> {
    this.logger.log(
      `Forwarding stop recording request to video-call microservice for huddle ${dto.huddleId}`,
    );
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.videoCallClient.send<StopRecordingResponseDto>(
            VIDEO_CALL_MESSAGE_PATTERN.STOP_RECORDING,
            dto,
          ),
        ),
      'stopRecording',
      'VideoCallService',
    );
  }

  async getRecordings(
    channelId: string,
    query: GetRecordingsQueryDto,
  ): Promise<HuddleRecordingsResponseDto> {
    this.logger.log(
      `Forwarding get recordings request to video-call microservice for channel ${channelId}`,
    );
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.videoCallClient.send<HuddleRecordingsResponseDto>(
            VIDEO_CALL_MESSAGE_PATTERN.GET_RECORDINGS,
            {
              channelId,
              query,
            },
          ),
        ),
      'getRecordings',
      'VideoCallService',
    );
  }
}
