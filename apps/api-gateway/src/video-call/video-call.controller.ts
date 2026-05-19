import { Body, Controller, Post, Param, HttpCode, HttpStatus, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { VideoCallService } from './video-call.service';
import { JoinHuddleApiDto, LeaveHuddleApiDto } from './dto/video-call-api.dto';
import { CurrentUser, type JwtUser, Public } from '@slack/common';
import { JoinHuddleResponseDto, LeaveHuddleResponseDto, WebhookResponseDto } from './dto/video-call-response.dto';
import { LiveKitWebhookPayload } from './dto/video-call-request.dto';

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
}
