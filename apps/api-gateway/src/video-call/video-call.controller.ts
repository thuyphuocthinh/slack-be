import { Body, Controller, Post, Param, HttpCode, HttpStatus, Headers, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { VideoCallService } from './video-call.service';
import { JoinHuddleApiDto, LeaveHuddleApiDto } from './dto/video-call-api.dto';
import { CurrentUser, type JwtUser, Public } from '@slack/common';
import { JoinHuddleResponseDto, LeaveHuddleResponseDto, WebhookResponseDto, StartRecordingResponseDto, StopRecordingResponseDto, HuddleRecordingsResponseDto } from './dto/video-call-response.dto';
import { LiveKitWebhookPayload, GetRecordingsQueryDto } from './dto/video-call-request.dto';

@ApiTags('Video Call / Huddle')
@Controller('video-call')
export class VideoCallController {
  constructor(private readonly videoCallService: VideoCallService) {}

  @Post('workspaces/:workspaceId/join')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Join or start a Huddle in a channel / DM' })
  @ApiResponse({ status: 201, type: JoinHuddleResponseDto, description: 'Successfully generated LiveKit token and huddle session' })
  async joinHuddle(
    @Param('workspaceId') workspaceId: string,
    @Body() body: JoinHuddleApiDto,
    @CurrentUser() user: JwtUser,
  ): Promise<JoinHuddleResponseDto> {
    return await this.videoCallService.joinHuddle({
      workspaceId,
      channelId: body.channelId,
      userId: user.sub,
      identity: user.sub,
      name: user.email || user.sub,
    });
  }

  @Post('workspaces/:workspaceId/leave')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Leave an active Huddle session' })
  @ApiResponse({ status: 200, type: LeaveHuddleResponseDto, description: 'Successfully registered user departure from huddle' })
  async leaveHuddle(
    @Param('workspaceId') workspaceId: string,
    @Body() body: LeaveHuddleApiDto,
    @CurrentUser() user: JwtUser,
  ): Promise<LeaveHuddleResponseDto> {
    return await this.videoCallService.leaveHuddle({
      huddleId: body.huddleId,
      userId: user.sub,
    });
  }

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle webhook events from LiveKit Server' })
  @ApiResponse({ status: 200, type: WebhookResponseDto, description: 'Successfully processed LiveKit webhook event' })
  async handleWebhook(
    @Headers('authorization') authHeader: string,
    @Body() body: LiveKitWebhookPayload,
  ): Promise<WebhookResponseDto> {
    return await this.videoCallService.handleWebhook({
      authHeader,
      body,
    });
  }

  @Post('huddles/:huddleId/start-recording')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start recording a Huddle call using LiveKit Egress' })
  @ApiResponse({ status: 200, type: StartRecordingResponseDto, description: 'Successfully started egress recording' })
  async startRecording(
    @Param('huddleId') huddleId: string,
  ): Promise<StartRecordingResponseDto> {
    return await this.videoCallService.startRecording({
      huddleId,
      roomName: huddleId,
    });
  }

  @Post('huddles/:huddleId/stop-recording')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Stop recording a Huddle call' })
  @ApiResponse({ status: 200, type: StopRecordingResponseDto, description: 'Successfully stopped egress recording' })
  async stopRecording(
    @Param('huddleId') huddleId: string,
  ): Promise<StopRecordingResponseDto> {
    return await this.videoCallService.stopRecording({
      huddleId,
    });
  }

  @Get('channels/:channelId/recordings')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get list huddle recordings for a channel' })
  @ApiResponse({ status: 200, type: HuddleRecordingsResponseDto, description: 'Successfully retrieved recordings list' })
  async getRecordings(
    @Param('channelId') channelId: string,
    @Query() query: GetRecordingsQueryDto,
  ): Promise<HuddleRecordingsResponseDto> {
    return await this.videoCallService.getRecordings(channelId, query);
  }
}
