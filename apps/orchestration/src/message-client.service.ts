import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  MESSAGE_MESSAGE_PATTERNS,
  NAME_SERVICE_TCP,
  ORCHESTRATION_CONSTANTS,
} from '@slack/constants';
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

// FE gửi content = JSON.stringify(editor.getJSON()) — cây rich text TipTap
// dạng {type:'doc', content:[{type:'paragraph', content:[{type:'text', text:'...'}]}]}
// ĐÃ STRINGIFY, nên content nhận được ở đây là 1 STRING chứa JSON, không phải
// object thuần. Bug cũ chỉ trả thẳng string đó (return content) — với message
// do bot tự tạo (plain string thật, JSON.parse sẽ throw) thì đúng, nhưng với
// message user gõ thật qua FE thì trả nguyên văn chuỗi JSON thay vì lời văn
// thật, khiến prompt gửi cho Supervisor rỗng/vô nghĩa. Cùng logic đệ quy với
// NotificationService.extractPlainHistoryText (đã chạy đúng trong production).
function extractContentText(content: unknown): string {
  const traverseTiptapNodes = (node: unknown): string => {
    const texts: string[] = [];
    const visit = (n: unknown): void => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) {
        n.forEach(visit);
        return;
      }
      const obj = n as Record<string, unknown>;
      if (obj.type === 'text' && typeof obj.text === 'string')
        texts.push(obj.text);
      if (Array.isArray(obj.content)) obj.content.forEach(visit);
    };
    visit(node);
    return texts.join(' ');
  };

  if (content && typeof content === 'object')
    return traverseTiptapNodes(content);
  if (typeof content !== 'string') return '';

  try {
    const parsed = JSON.parse(content);
    return typeof parsed === 'string' ? parsed : traverseTiptapNodes(parsed);
  } catch {
    return content; // không phải JSON — plain text thật (VD message bot tự tạo)
  }
}

@Injectable()
export class MessageClientService {
  constructor(
    @Inject(NAME_SERVICE_TCP.MESSAGE_SERVICE)
    private readonly messageService: ClientProxy,
  ) {}

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
   * Giai đoạn 4, Step 5 — nếu còn tin nhắn cũ hơn cửa sổ này (`nextCursor`
   * message-service trả về), chèn thêm 1 turn tóm tắt rule-based ở ĐẦU mảng
   * để model không mất hoàn toàn ngữ cảnh cũ.
   */
  async getRecentHistory(
    dto: GetRecentHistoryRequestDto,
  ): Promise<ChatHistoryTurnDto[]> {
    const result = await firstValueFrom(
      this.messageService.send(MESSAGE_MESSAGE_PATTERNS.GET_MESSAGES, {
        channelId: dto.channelId,
        userId: dto.userId,
        cursor: dto.beforeMessageId,
        direction: 'before',
        limit: dto.limit,
      }),
    );

    const { messages, nextCursor } = result as {
      messages: MessageLike[];
      nextCursor?: string;
    };
    const history = (messages ?? [])
      .slice()
      .reverse() // API trả DESC (mới nhất trước) — đảo lại thành cũ → mới
      .map((m) => ({
        role: (m.sender?.isBot
          ? 'model'
          : 'user') as ChatHistoryTurnDto['role'],
        text: extractContentText(m.content),
      }))
      .filter((turn) => turn.text.trim().length > 0);

    if (!nextCursor) return history;

    const summaryTurn = await this.buildTruncatedHistorySummary(
      dto,
      nextCursor,
    );
    return summaryTurn ? [summaryTurn, ...history] : history;
  }

  // Lấy 1 lô nhỏ tin NGAY TRƯỚC cửa sổ CHAT_HISTORY_LIMIT, ghép text lại
  // thành 1 câu tóm tắt ngắn — không gọi thêm LLM (v1 rule-based, xem
  // stage4_step.md Step 5). Lỗi ở đây (VD message service tạm lỗi) chỉ mất
  // phần tóm tắt, không chặn luồng chính — trả null để getRecentHistory() bỏ qua.
  private async buildTruncatedHistorySummary(
    dto: GetRecentHistoryRequestDto,
    beforeMessageId: string,
  ): Promise<ChatHistoryTurnDto | null> {
    try {
      const result = await firstValueFrom(
        this.messageService.send(MESSAGE_MESSAGE_PATTERNS.GET_MESSAGES, {
          channelId: dto.channelId,
          userId: dto.userId,
          cursor: beforeMessageId,
          direction: 'before',
          limit: ORCHESTRATION_CONSTANTS.TRUNCATED_HISTORY_SUMMARY_LOOKBACK,
        }),
      );
      const messages = (result as { messages: MessageLike[] }).messages ?? [];
      const snippets = messages
        .slice()
        .reverse()
        .map((m) => extractContentText(m.content).trim())
        .filter((text) => text.length > 0);
      if (snippets.length === 0) return null;

      const maxChars =
        ORCHESTRATION_CONSTANTS.TRUNCATED_HISTORY_SUMMARY_MAX_CHARS;
      const joined = snippets.join('; ');
      const summaryText =
        joined.length > maxChars ? `${joined.slice(0, maxChars)}...` : joined;

      return {
        role: 'user',
        text: `(Tóm tắt ngữ cảnh cũ hơn, KHÔNG phải câu hỏi mới) Trước đó, cuộc trò chuyện đã đề cập: ${summaryText}`,
      };
    } catch {
      return null;
    }
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

  async updateMessage(
    dto: UpdateOrchestrationMessageRequestDto,
  ): Promise<void> {
    await firstValueFrom(
      this.messageService.send(MESSAGE_MESSAGE_PATTERNS.UPDATE, {
        id: dto.id,
        userId: dto.userId,
        updateDto: { content: dto.content, toolCalls: dto.toolCalls },
      }),
    );
  }
}
