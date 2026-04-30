import { Controller } from '@nestjs/common';
import { MessageService } from './service/message.service';
import { ThreadService } from './service/thread.service';

import { MessagePattern, Payload } from '@nestjs/microservices';
import { MESSAGE_MESSAGE_PATTERNS } from '@slack/constants';
import {
  CreateMessageDto,
  GetMessagesQueryDto,
  UpdateMessageDto,
  ToggleReactionDto,
} from './dto';
import { GetThreadQueryDto } from './dto/get-thread-query.dto';

@Controller()
export class MessageController {
  constructor(
    private readonly messageService: MessageService,
    private readonly threadService: ThreadService,
  ) {}

  @MessagePattern(MESSAGE_MESSAGE_PATTERNS.CREATE)
  createMessage(@Payload() createMessageDto: CreateMessageDto) {
    return this.messageService.createMessage(createMessageDto);
  }

  @MessagePattern(MESSAGE_MESSAGE_PATTERNS.GET_MESSAGES)
  getMessages(@Payload() query: GetMessagesQueryDto) {
    return this.messageService.getMessages(query);
  }

  @MessagePattern(MESSAGE_MESSAGE_PATTERNS.GET_BY_ID)
  getMessageById(@Payload() data: { id: string; userId: string }) {
    return this.messageService.getMessageById(data.id, data.userId);
  }

  @MessagePattern(MESSAGE_MESSAGE_PATTERNS.UPDATE)
  updateMessage(
    @Payload()
    data: {
      id: string;
      userId: string;
      updateDto: UpdateMessageDto;
    },
  ) {
    return this.messageService.updateMessage(
      data.id,
      data.userId,
      data.updateDto,
    );
  }

  @MessagePattern(MESSAGE_MESSAGE_PATTERNS.DELETE)
  deleteMessage(@Payload() data: { id: string; userId: string }) {
    return this.messageService.deleteMessage(data.id, data.userId);
  }

  @MessagePattern(MESSAGE_MESSAGE_PATTERNS.TOGGLE_REACTION)
  toggleReaction(
    @Payload() data: { userId: string; toggleDto: ToggleReactionDto },
  ) {
    return this.messageService.toggleReaction(data.userId, data.toggleDto);
  }

  @MessagePattern(MESSAGE_MESSAGE_PATTERNS.TOGGLE_PIN)
  togglePin(@Payload() data: { id: string; userId: string }) {
    return this.messageService.togglePin(data.id, data.userId);
  }

  @MessagePattern(MESSAGE_MESSAGE_PATTERNS.SEARCH)
  searchMessages(
    @Payload() query: { keyword: string; channelId: string; senderId: string },
  ) {
    return this.messageService.searchMessages(query);
  }

  @MessagePattern(MESSAGE_MESSAGE_PATTERNS.GET_THREADS)
  getThreads(@Payload() query: GetThreadQueryDto) {
    return this.threadService.getUserThreads(
      query.userId,
      query.limit,
      query.cursor,
    );
  }
}
