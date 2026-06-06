import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { MESSAGE_MESSAGE_PATTERNS, NAME_SERVICE_TCP } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';
import {
  CreateMessageRequestDto,
  GetMessagesRequestDto,
  GetThreadRequestDto,
  SearchMessagesRequestDto,
  ToggleReactionRequestDto,
  UpdateMessageRequestDto,
  GetPinnedMessagesRequestDto,
  GetSurroundingMessagesRequestDto,
  GetAttachmentsRequestDto,
  GetFullThreadRequestDto,
} from './dto/message-request.dto';

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.MESSAGE_SERVICE)
    private readonly messageClient: ClientProxy,
  ) {}

  async createMessage(dto: CreateMessageRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.CREATE, dto),
        ),
      'createMessage',
      'MessageService',
    );
  }

  async getMessages(dto: GetMessagesRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.GET_MESSAGES, dto),
        ),
      'getMessages',
      'MessageService',
    );
  }

  async getThreads(dto: GetThreadRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.GET_THREADS, dto),
        ),
      'getThreads',
      'MessageService',
    );
  }

  async getFullThread(dto: GetFullThreadRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.messageClient.send(
            MESSAGE_MESSAGE_PATTERNS.GET_FULL_THREAD,
            dto,
          ),
        ),
      'getFullThread',
      'MessageService',
    );
  }

  async getPinnedMessages(dto: GetPinnedMessagesRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.messageClient.send(
            MESSAGE_MESSAGE_PATTERNS.GET_PINNED_MESSAGES,
            dto,
          ),
        ),
      'getPinnedMessages',
      'MessageService',
    );
  }

  async getSurroundingMessages(dto: GetSurroundingMessagesRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.messageClient.send(
            MESSAGE_MESSAGE_PATTERNS.GET_SURROUNDING_MESSAGES,
            dto,
          ),
        ),
      'getSurroundingMessages',
      'MessageService',
    );
  }

  async searchMessages(dto: SearchMessagesRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.SEARCH, dto),
        ),
      'searchMessages',
      'MessageService',
    );
  }

  async getMessageById(messageId: string, userId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.GET_BY_ID, {
            id: messageId,
            userId,
          }),
        ),
      'getMessageById',
      'MessageService',
    );
  }

  async updateMessage(dto: UpdateMessageRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.UPDATE, {
            id: dto.messageId,
            userId: dto.userId,
            updateDto: dto,
          }),
        ),
      'updateMessage',
      'MessageService',
    );
  }

  async deleteMessage(messageId: string, userId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.DELETE, {
            id: messageId,
            userId,
          }),
        ),
      'deleteMessage',
      'MessageService',
    );
  }

  async toggleReaction(dto: ToggleReactionRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.TOGGLE_REACTION, {
            userId: dto.userId,
            toggleDto: { emoji: dto.emoji, messageId: dto.messageId },
          }),
        ),
      'toggleReaction',
      'MessageService',
    );
  }

  async togglePin(messageId: string, userId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.TOGGLE_PIN, {
            id: messageId,
            userId,
          }),
        ),
      'togglePin',
      'MessageService',
    );
  }

  async getAttachments(dto: GetAttachmentsRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.messageClient.send(
            MESSAGE_MESSAGE_PATTERNS.GET_ATTACHMENTS,
            dto,
          ),
        ),
      'getAttachments',
      'MessageService',
    );
  }
}
