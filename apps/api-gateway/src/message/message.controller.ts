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
} from './dto/message-api.dto';
import {
  CreateMessageRequestDto,
  GetMessagesRequestDto,
  UpdateMessageRequestDto,
  ToggleReactionRequestDto,
  SearchMessagesRequestDto,
} from './dto/message-request.dto';

@ApiTags('Messages')
@Controller('workspaces/:workspaceId/channels/:channelId/messages')
@ApiBearerAuth()
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Post()
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
      query: query.keyword,
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
}
