import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { MESSAGE_MESSAGE_PATTERNS, NAME_SERVICE_TCP } from '@slack/constants';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.MESSAGE_SERVICE)
    private readonly messageClient: ClientProxy,
  ) {}

  async createMessage(data: any) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.CREATE, data),
    );
  }

  async getMessages(query: any) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.GET_MESSAGES, query),
    );
  }

  async getMessageById(id: string, userId: string) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.GET_BY_ID, {
        id,
        userId,
      }),
    );
  }

  async updateMessage(id: string, userId: string, updateDto: any) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.UPDATE, {
        id,
        userId,
        updateDto,
      }),
    );
  }

  async deleteMessage(id: string, userId: string) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.DELETE, { id, userId }),
    );
  }

  async toggleReaction(userId: string, toggleDto: any) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.TOGGLE_REACTION, {
        userId,
        toggleDto,
      }),
    );
  }

  async togglePin(id: string, userId: string) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.TOGGLE_PIN, {
        id,
        userId,
      }),
    );
  }

  async searchMessages(query: any) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.SEARCH, query),
    );
  }

  async getThreads(query: any) {
    return await firstValueFrom(
      this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.GET_THREADS, query),
    );
  }
}
