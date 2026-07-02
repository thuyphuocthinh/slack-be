import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { MESSAGE_MESSAGE_PATTERNS, NAME_SERVICE_TCP } from '@slack/constants';
import {
  ChatHistoryTurnDto,
  CreateOrchestrationMessageRequestDto,
  CreateOrchestrationMessageResponseDto,
  GetMessageTextRequestDto,
  GetRecentHistoryRequestDto,
  UpdateOrchestrationMessageRequestDto,
} from './dto/message-client.dto';

interface MessageLike {
  content: unknown;
  sender?: { isBot?: boolean };
}

function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && 'text' in (content as Record<string, unknown>)) {
    return String((content as Record<string, unknown>).text ?? '');
  }
  return '';
}

@Injectable()
export class MessageClientService {
  constructor(
    @Inject(NAME_SERVICE_TCP.MESSAGE_SERVICE)
    private readonly messageService: ClientProxy,
  ) { }

  async getMessageText(dto: GetMessageTextRequestDto): Promise<string> {
    const message = await firstValueFrom(
      this.messageService.send(MESSAGE_MESSAGE_PATTERNS.GET_BY_ID, {
        id: dto.id,
        userId: dto.userId,
      }),
    );
    return extractContentText((message as MessageLike).content);
  }

  /**
   * N message gần nhất TRƯỚC `beforeMessageId` trong channel, theo thứ tự
   * thời gian tăng dần (cũ → mới) — đúng thứ tự Gemini `startChat({history})` cần.
   */
  async getRecentHistory(dto: GetRecentHistoryRequestDto): Promise<ChatHistoryTurnDto[]> {
    const result = await firstValueFrom(
      this.messageService.send(MESSAGE_MESSAGE_PATTERNS.GET_MESSAGES, {
        channelId: dto.channelId,
        userId: dto.userId,
        cursor: dto.beforeMessageId,
        direction: 'before',
        limit: dto.limit,
      }),
    );

    const messages = (result as { messages: MessageLike[] }).messages ?? [];
    return messages
      .slice()
      .reverse() // API trả DESC (mới nhất trước) — đảo lại thành cũ → mới
      .map((m) => ({
        role: (m.sender?.isBot ? 'model' : 'user') as ChatHistoryTurnDto['role'],
        text: extractContentText(m.content),
      }))
      .filter((turn) => turn.text.trim().length > 0);
  }

  async createMessage(
    dto: CreateOrchestrationMessageRequestDto,
  ): Promise<CreateOrchestrationMessageResponseDto> {
    return firstValueFrom(
      this.messageService.send(MESSAGE_MESSAGE_PATTERNS.CREATE, {
        channelId: dto.channelId,
        senderId: dto.senderId,
        content: dto.content,
      }),
    );
  }

  async updateMessage(dto: UpdateOrchestrationMessageRequestDto): Promise<void> {
    await firstValueFrom(
      this.messageService.send(MESSAGE_MESSAGE_PATTERNS.UPDATE, {
        id: dto.id,
        userId: dto.userId,
        updateDto: { content: dto.content },
      }),
    );
  }
}
