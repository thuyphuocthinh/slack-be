import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type JwtUser } from '@slack/common';
import { MessageService } from './message.service';
import {
  CreateMessageApiDto,
  GetMessagesQueryApiDto,
  UpdateMessageApiDto,
  ToggleReactionApiDto,
  SearchMessagesQueryApiDto,
  GetPinnedMessagesQueryApiDto,
  GetSurroundingMessagesQueryApiDto,
  GetAttachmentsQueryApiDto,
} from './dto/message-api.dto';
import {
  CreateMessageRequestDto,
  GetMessagesRequestDto,
  UpdateMessageRequestDto,
  ToggleReactionRequestDto,
  SearchMessagesRequestDto,
  GetPinnedMessagesRequestDto,
  GetSurroundingMessagesRequestDto,
  GetAttachmentsRequestDto,
} from './dto/message-request.dto';

import { RateLimit } from '../common/guards/rate-limit.decorator';

@ApiTags('Messages')
@Controller('workspaces/:workspaceId/channels/:channelId/messages')
@ApiBearerAuth()
export class MessageController {
  constructor(private readonly messageService: MessageService) { }

  @Post()
  @RateLimit({ limit: 10, window: 10 })
  @ApiOperation({ summary: 'Create a new message' })
  async createMessage(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Body() data: CreateMessageApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.createMessage({
      ...data,
      channelId,
      senderId: user.sub,
    } as CreateMessageRequestDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get messages' })
  async getMessages(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Query() query: GetMessagesQueryApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.getMessages({
      ...query,
      channelId,
      userId: user.sub,
    } as GetMessagesRequestDto);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search messages' })
  async searchMessages(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Query() query: SearchMessagesQueryApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.searchMessages({
      keyword: query.keyword,
      limit: query.limit,
      cursor: query.cursor,
      channelId,
      senderId: user.sub,
    } as SearchMessagesRequestDto);
  }

  @Get('item/:id')
  @ApiOperation({ summary: 'Get message by ID' })
  async getMessageById(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.getMessageById(id, user.sub);
  }

  @Patch('item/:id')
  @ApiOperation({ summary: 'Update message' })
  async updateMessage(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @Body() data: UpdateMessageApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.updateMessage({
      ...data,
      messageId: id,
      userId: user.sub,
    } as UpdateMessageRequestDto);
  }

  @Delete('item/:id')
  @ApiOperation({ summary: 'Delete message' })
  async deleteMessage(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.deleteMessage(id, user.sub);
  }

  @Post('item/:id/reaction')
  @ApiOperation({ summary: 'Toggle reaction' })
  async toggleReaction(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Param('id') messageId: string,
    @Body() data: ToggleReactionApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.toggleReaction({
      ...data,
      messageId,
      userId: user.sub,
    } as ToggleReactionRequestDto);
  }

  @Post('item/:id/pin')
  @ApiOperation({ summary: 'Toggle pin message' })
  async togglePin(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.togglePin(id, user.sub);
  }

  @Get('pinned')
  @ApiOperation({ summary: 'Get pinned messages' })
  async getPinnedMessages(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Query() query: GetPinnedMessagesQueryApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.getPinnedMessages({
      ...query,
      channelId,
      userId: user.sub,
    } as GetPinnedMessagesRequestDto);
  }

  @Get('item/:id/surrounding')
  @ApiOperation({ summary: 'Get surrounding messages' })
  async getSurroundingMessages(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @Query() query: GetSurroundingMessagesQueryApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.getSurroundingMessages({
      ...query,
      channelId,
      targetMessageId: id,
      userId: user.sub,
    } as GetSurroundingMessagesRequestDto);
  }

  @Get('attachments')
  @ApiOperation({ summary: 'Get channel attachments' })
  async getAttachments(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Query() query: GetAttachmentsQueryApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.getAttachments({
      channelId,
      query,
    } as GetAttachmentsRequestDto);
  }
}
