import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { MESSAGE_MESSAGE_PATTERNS, NAME_SERVICE_TCP } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import {
  CreateMessageRequestDto,
  GetMessagesRequestDto,
  GetThreadRequestDto,
  SearchMessagesRequestDto,
  ToggleReactionRequestDto,
  UpdateMessageRequestDto,
} from './dto/message-request.dto';

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.MESSAGE_SERVICE)
    private readonly messageClient: ClientProxy,
  ) { }

  async createMessage(dto: CreateMessageRequestDto) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.CREATE, dto),
    );
  }

  async getMessages(dto: GetMessagesRequestDto) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.GET_MESSAGES, dto),
    );
  }

  async getThreads(dto: GetThreadRequestDto) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.GET_THREADS, dto),
    );
  }

  async searchMessages(dto: SearchMessagesRequestDto) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.SEARCH, dto),
    );
  }

  async getMessageById(messageId: string, userId: string) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.GET_BY_ID, {
        id: messageId,
        userId,
      }),
    );
  }

  async updateMessage(dto: UpdateMessageRequestDto) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.UPDATE, {
        id: dto.messageId,
        userId: dto.userId,
        updateDto: dto,
      }),
    );
  }

  async deleteMessage(messageId: string, userId: string) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.DELETE, {
        id: messageId,
        userId,
      }),
    );
  }

  async toggleReaction(dto: ToggleReactionRequestDto) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.TOGGLE_REACTION, {
        userId: dto.userId,
        toggleDto: { emoji: dto.emoji, messageId: dto.messageId },
      }),
    );
  }

  async togglePin(messageId: string, userId: string) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.TOGGLE_PIN, {
        id: messageId,
        userId,
      }),
    );
  }
}
