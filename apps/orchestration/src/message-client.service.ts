import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { JsonRepair } from 'agentic-io-parser';
import { firstValueFrom } from 'rxjs';
import {
  EMessageRole,
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
import { ToolCallTraceDto } from './dto/react-loop.dto';
import { ChannelMemoryService } from './memory/channel-memory.service';
import { LlmStrategyFactory } from './llm/strategy/llm-strategy.factory';
import { CircuitBreakerService } from './common/circuit-breaker.service';
import { withLlmRetry } from './llm/with-llm-retry.util';

interface MessageLike {
  content: unknown;
  sender?: { isBot?: boolean };
  toolCalls?: ToolCallTraceDto[] | null;
}

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
    const repair = new JsonRepair();
    const parsed = JSON.parse(repair.repair(content as string));
    return typeof parsed === 'string' ? parsed : traverseTiptapNodes(parsed);
  } catch {
    return content as string; // không phải JSON — plain text thật (VD message bot tự tạo)
  }
}

const REDACTED_MODEL_ANSWER_TEXT =
  '(nội dung câu trả lời cũ đã ẩn khỏi ngữ cảnh này — KHÔNG được dùng làm dữ liệu; nếu câu hỏi hiện tại cần dữ liệu/số liệu cụ thể, PHẢI delegate lại để lấy MỚI)';

// Giai đoạn 2 (Agent OS) — "Compress": tóm tắt bằng LLM thay vì chỉ nối câu
// (rule-based) như trước, để giữ lại Ý CHÍNH thay vì cắt cụt giữa chừng.
const HISTORY_SUMMARY_PROMPT =
  'Tóm tắt các đoạn hội thoại sau thành 1-2 câu ngắn gọn, giữ lại thông tin/quyết định quan trọng nhất. Chỉ trả về phần tóm tắt, không thêm lời dẫn.';

const HISTORY_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Bản tóm tắt ngắn gọn 1-2 câu.',
    },
  },
  required: ['summary'],
};

@Injectable()
export class MessageClientService {
  private readonly logger = new Logger(MessageClientService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.MESSAGE_SERVICE)
    private readonly messageService: ClientProxy,
    private readonly channelMemory: ChannelMemoryService,
    private readonly llmFactory: LlmStrategyFactory,
    private readonly circuitBreaker: CircuitBreakerService,
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
    const reversed = (messages ?? []).slice().reverse(); // API trả DESC (mới nhất trước) — đảo lại thành cũ → mới

    // ver3.md mục 1 (ngắn hạn) — recap toolCalls của N lượt BOT gần nhất có
    // gọi tool, keyed theo object reference (không phải index) để không lệch
    // vị trí sau bước filter(text rỗng) bên dưới.
    const recentBotMessagesWithToolCalls = reversed
      .filter((m) => m.sender?.isBot && (m.toolCalls?.length ?? 0) > 0)
      .slice(-ORCHESTRATION_CONSTANTS.TOOL_CALL_RECAP_LOOKBACK_TURNS);
    const recapByMessage = new Map(
      recentBotMessagesWithToolCalls.map((m) => [
        m,
        this.buildToolCallRecap(m.toolCalls!),
      ]),
    );

    const history = reversed
      .map((m) => ({
        role: (m.sender?.isBot
          ? 'model'
          : 'user') as ChatHistoryTurnDto['role'],
        text: extractContentText(m.content),
        _raw: m,
      }))
      .filter((turn) => turn.text.trim().length > 0)
      .map((turn) => {
        if (turn.role !== 'model') return { role: turn.role, text: turn.text };
        const recap = recapByMessage.get(turn._raw);
        return {
          role: turn.role,
          text: recap
            ? `${REDACTED_MODEL_ANSWER_TEXT}\n${recap}`
            : REDACTED_MODEL_ANSWER_TEXT,
        };
      });

    if (!nextCursor)
      return this.capHistoryToCharBudget(history, dto.charBudget);

    const summaryTurn = await this.buildTruncatedHistorySummary(
      dto,
      nextCursor,
    );
    const withSummary = summaryTurn ? [summaryTurn, ...history] : history;
    return this.capHistoryToCharBudget(withSummary, dto.charBudget);
  }

  // Giai đoạn 2 (Agent OS) — lưới an toàn cuối cùng, KHÔNG thay cơ chế
  // turn-count/redact/recap ở trên. Cắt từ ĐẦU (turn cũ nhất) trước, luôn giữ
  // ít nhất turn MỚI NHẤT dù riêng nó đã vượt budget — cùng tinh thần
  // capToCharBudget() ở ChannelMemoryService.
  private capHistoryToCharBudget(
    history: ChatHistoryTurnDto[],
    charBudget?: number,
  ): ChatHistoryTurnDto[] {
    if (charBudget === undefined) return history;

    const kept = [...history];
    let used = kept.reduce((sum, turn) => sum + turn.text.length, 0);
    while (used > charBudget && kept.length > 1) {
      used -= kept.shift()!.text.length;
    }
    return kept;
  }

  // ver3.md mục 1 (ngắn hạn) — ghi lại "đã thử làm gì, kết quả sao" (hành
  // động, không phải số liệu), giải quyết pattern "chèn lại đi"/"còn thiếu
  // cái ni" mà không cần user lặp lại nguyên văn prompt gốc.
  private buildToolCallRecap(toolCalls: ToolCallTraceDto[]): string {
    const statusLabel: Record<ToolCallTraceDto['status'], string> = {
      success: 'THÀNH CÔNG',
      error: 'THẤT BẠI',
      awaiting_approval: 'ĐANG CHỜ DUYỆT',
    };
    const joined = toolCalls
      .map((tc) => {
        const args = tc.argsPreview ? ` (${tc.argsPreview})` : '';
        const result = tc.resultPreview ? `: ${tc.resultPreview}` : '';
        return `${tc.tool}${args} → ${statusLabel[tc.status]}${result}`;
      })
      .join('; ');

    const maxChars = ORCHESTRATION_CONSTANTS.TOOL_CALL_RECAP_MAX_CHARS_PER_TURN;
    const capped =
      joined.length > maxChars ? `${joined.slice(0, maxChars)}...` : joined;
    return `Lượt trước đã thử: ${capped}`;
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

      const summaryText = await this.summarizeSnippets(snippets);

      return {
        role: EMessageRole.USER,
        text: `(Tóm tắt ngữ cảnh cũ hơn, KHÔNG phải câu hỏi mới) Trước đó, cuộc trò chuyện đã đề cập: ${summaryText}`,
      };
    } catch {
      return null;
    }
  }

  // "Compress" — thử tóm tắt bằng LLM (giữ Ý CHÍNH thay vì cắt cụt); lỗi/timeout
  // thì rơi về đúng hành vi CŨ (nối câu + cắt độ dài), không chặn luồng chính.
  private async summarizeSnippets(snippets: string[]): Promise<string> {
    const maxChars =
      ORCHESTRATION_CONSTANTS.TRUNCATED_HISTORY_SUMMARY_MAX_CHARS;
    const joined = snippets.join('; ');
    const fallback =
      joined.length > maxChars ? `${joined.slice(0, maxChars)}...` : joined;

    try {
      const modelId =
        process.env.HISTORY_SUMMARY_MODEL ??
        process.env.SUPERVISOR_MODEL ??
        ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL;
      const { strategy, model } = this.llmFactory.resolve(modelId);

      const result = await this.circuitBreaker.run(`llm:${strategy.id}`, () =>
        withLlmRetry(
          (signal) =>
            strategy.generateStructured<{ summary: string }>({
              model,
              systemInstruction: HISTORY_SUMMARY_PROMPT,
              prompt: joined,
              schema: HISTORY_SUMMARY_SCHEMA,
              signal,
            }),
          ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
          `History summary timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (model=${model})`,
        ),
      );

      const summary = result.summary?.trim();
      return summary ? summary : fallback;
    } catch (error) {
      this.logger.warn(
        `summarizeSnippets() LLM failed, falling back to rule-based join: ${(error as Error).message}`,
      );
      return fallback;
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
        updateDto: {
          content: dto.content,
          toolCalls: dto.toolCalls,
          executionTimeMs: dto.executionTimeMs,
        },
      }),
    );

    // ver3.md mục 1 (dài hạn) — ghi channel_memory CHỈ khi caller có channelId
    // (call site có toolCalls thật) VÀ có toolCalls; ChannelMemoryService tự
    // lọc CREATE-type/success và tự nuốt lỗi, không chặn update() chính.
    if (dto.channelId && dto.toolCalls?.length) {
      await this.channelMemory.recordSuccessfulCreateCalls(
        dto.channelId,
        dto.id,
        dto.toolCalls,
      );
    }
  }

  // Dùng ở NHÁNH BÁO LỖI (catch) của các luồng turn/checkpoint — checkpoint
  // hoặc trigger claim đã claim() xong, không rollback được, nên nếu NGAY CẢ
  // update báo lỗi này cũng lỗi (message-service chập chờn), TUYỆT ĐỐI không
  // để nó văng tiếp ra ngoài: bấm lại chỉ ra CHECKPOINT_NOT_FOUND/im lặng mà
  // không ai biết lỗi gốc nằm đâu, và job bị retry vô ích (claim đã chặn).
  async tryUpdateMessage(
    dto: UpdateOrchestrationMessageRequestDto,
  ): Promise<void> {
    try {
      await this.updateMessage(dto);
    } catch (error) {
      this.logger.error(
        `tryUpdateMessage() failed for message ${dto.id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
