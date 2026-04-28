import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ChannelService } from './channel.service';
import {
  CreateChannelApiDto,
  UpdateChannelApiDto,
  GetChannelsApiDto,
  AddMemberApiDto,
  AddBatchMembersApiDto,
} from './dto/channel-api.dto';
import { CurrentUser, type JwtUser } from '@slack/common';

@ApiTags('Channels')
@Controller('workspaces/:workspaceId/channels')
@ApiBearerAuth()
export class ChannelController {
  private readonly logger = new Logger(ChannelController.name);

  constructor(private readonly channelService: ChannelService) { }

  @Post()
  @ApiOperation({ summary: 'Create a new channel' })
  @ApiResponse({ status: 201, description: 'Channel created successfully' })
  async createChannel(
    @Param('workspaceId') workspaceId: string,
    @Body() data: CreateChannelApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.channelService.createChannel({
      ...data,
      workspaceId,
      memberId: user.sub,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get all channels in a workspace' })
  @ApiResponse({ status: 200, description: 'Channels retrieved successfully' })
  async getChannels(
    @Param('workspaceId') workspaceId: string,
    @Query() query: GetChannelsApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.channelService.getChannels({
      ...query,
      workspaceId,
      memberId: user.sub,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a channel by ID' })
  @ApiResponse({ status: 200, description: 'Channel retrieved successfully' })
  async getChannel(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.channelService.getChannel(id, user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a channel' })
  @ApiResponse({ status: 200, description: 'Channel updated successfully' })
  async updateChannel(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() data: UpdateChannelApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.channelService.updateChannel({
      ...data,
      channelId: id,
      memberId: user.sub,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a channel' })
  @ApiResponse({ status: 200, description: 'Channel deleted successfully' })
  async deleteChannel(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.channelService.deleteChannel(id, user.sub);
  }

  @Patch(':id/star')
  @ApiOperation({ summary: 'Toggle star on a channel' })
  @ApiResponse({ status: 200, description: 'Channel starred/unstarred successfully' })
  async toggleStar(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.channelService.toggleStar({
      channelId: id,
      memberId: user.sub,
    });
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add a member to a channel' })
  @ApiResponse({ status: 201, description: 'Member added successfully' })
  async addMember(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() data: AddMemberApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.channelService.addMember({
      channelId: id,
      targetMemberId: data.targetMemberId,
      performerId: user.sub,
    });
  }

  @Post(':id/batch-members')
  @ApiOperation({ summary: 'Add multiple members to a channel' })
  @ApiResponse({ status: 201, description: 'Members added successfully' })
  async addBatchMembers(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() data: AddBatchMembersApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.channelService.addBatchMembers({
      channelId: id,
      targetMemberIds: data.targetMemberIds,
      performerId: user.sub,
    });
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove a member from a channel' })
  @ApiResponse({ status: 200, description: 'Member removed successfully' })
  async removeMember(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.channelService.removeMember({
      channelId: id,
      targetMemberId: userId,
      performerId: user.sub,
    });
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Get all members of a channel' })
  @ApiResponse({ status: 200, description: 'Members retrieved successfully' })
  async getMembers(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string
  ) {
    return await this.channelService.getMembers(id);
  }

  @Post(':id/leave')
  @ApiOperation({ summary: 'Leave a channel' })
  @ApiResponse({ status: 200, description: 'Left channel successfully' })
  async leaveChannel(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.channelService.leaveChannel(id, user.sub);
  }
}
