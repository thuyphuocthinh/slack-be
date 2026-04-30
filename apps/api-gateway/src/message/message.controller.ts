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
  GetThreadQueryApiDto,
} from './dto/message-api.dto';

@ApiTags('Messages')
@Controller('messages')
@ApiBearerAuth()
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new message' })
  async createMessage(
    @Body() data: CreateMessageApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.createMessage({
      ...data,
      senderId: user.sub,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get messages' })
  async getMessages(
    @Query() query: GetMessagesQueryApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.getMessages({
      ...query,
      userId: user.sub,
    });
  }

  @Get('threads')
  @ApiOperation({ summary: 'Get user threads' })
  async getThreads(
    @Query() query: GetThreadQueryApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.getThreads({
      ...query,
      userId: user.sub,
    });
  }

  @Get('search')
  @ApiOperation({ summary: 'Search messages' })
  async searchMessages(
    @Query() query: SearchMessagesQueryApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.searchMessages({
      ...query,
      senderId: user.sub,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get message by ID' })
  async getMessageById(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return await this.messageService.getMessageById(id, user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update message' })
  async updateMessage(
    @Param('id') id: string,
    @Body() data: UpdateMessageApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.updateMessage(id, user.sub, data);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete message' })
  async deleteMessage(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return await this.messageService.deleteMessage(id, user.sub);
  }

  @Post('reaction')
  @ApiOperation({ summary: 'Toggle reaction' })
  async toggleReaction(
    @Body() data: ToggleReactionApiDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.messageService.toggleReaction(user.sub, data);
  }

  @Post(':id/pin')
  @ApiOperation({ summary: 'Toggle pin message' })
  async togglePin(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return await this.messageService.togglePin(id, user.sub);
  }
}
