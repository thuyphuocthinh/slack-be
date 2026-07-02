import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  GoogleGenerativeAI,
  type Content,
  type FunctionDeclarationSchema,
  type Part,
  type Tool,
} from '@google/generative-ai';
import { traceable } from 'langsmith/traceable';
import {
  ESocketEvent,
  ORCHESTRATION_CONSTANTS,
  ORCHESTRATION_ERROR,
  ORCHESTRATION_SELF_CHECK_PROMPT,
  ORCHESTRATION_SYSTEM_PROMPT,
} from '@slack/constants';
import { extractTextFromMcpResult } from '@slack/common';
import { EJobName, EQueueName, QueueService } from '@slack/queue';
import { McpClientService } from '../mcp/mcp-client.service';
import { MessageClientService } from '../message-client.service';
import { ChatHistoryTurnDto } from '../dto/message-client.dto';
import { RunReactLoopRequestDto, RunReactLoopResponseDto, ToolCallTraceDto } from '../dto/react-loop.dto';

@Injectable()
export class GeminiReactService {
  private readonly logger = new Logger(GeminiReactService.name);
  private readonly genAI?: GoogleGenerativeAI;

  constructor(
    private readonly mcpClient: McpClientService,
    private readonly queueService: QueueService,
    private readonly messageClient: MessageClientService,
  ) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    } else {
      this.logger.warn('GEMINI_API_KEY is not defined in environment variables');
    }
  }

  async run(dto: RunReactLoopRequestDto): Promise<RunReactLoopResponseDto> {
    const traced = traceable((requestDto: RunReactLoopRequestDto) => this.executeReactLoop(requestDto), {
      name: 'gemini-react-loop',
      metadata: {
        userId: dto.userId,
        channelId: dto.channelId,
        workspaceId: dto.workspaceId,
        messageId: dto.messageId,
      },
    });
    try {
      return (await traced(dto)) as RunReactLoopResponseDto;
    } finally {
      // Luôn báo "done" dù thành công hay lỗi — FE dựa vào tín hiệu này để tắt
      // icon "đang chạy tool...", không thì nó treo mãi tới khi F5 lại trang.
      await this.emitAgentStep(dto, { type: 'done' });
    }
  }

  private async executeReactLoop(dto: RunReactLoopRequestDto): Promise<RunReactLoopResponseDto> {
    if (!this.genAI) {
      throw new RpcException(ORCHESTRATION_ERROR.GEMINI_NOT_CONFIGURED);
    }

    const toolCalls: ToolCallTraceDto[] = [];

    const [mcpTools, history] = await Promise.all([
      this.mcpClient.getTools(dto.provider),
      this.messageClient.getRecentHistory({
        channelId: dto.channelId,
        userId: dto.userId,
        beforeMessageId: dto.triggerMessageId,
        limit: ORCHESTRATION_CONSTANTS.CHAT_HISTORY_LIMIT,
      }),
    ]);
    const tools: Tool[] = [
      {
        functionDeclarations: mcpTools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: this.toGeminiSchema(t.inputSchema),
        })),
      },
    ];

    const model = this.genAI.getGenerativeModel({
      model: ORCHESTRATION_CONSTANTS.GEMINI_MODEL,
      tools,
      systemInstruction: ORCHESTRATION_SYSTEM_PROMPT,
    });
    const chat = model.startChat({ history: this.toGeminiHistory(history) });

    // Wrap trong scope của executeReactLoop (đã traceable ở run()) — tự nest
    // thành child span đúng cây theo AsyncLocalStorage, không cần truyền context tay.
    // withRetry bọc bên trong cùng 1 span — retry vẫn xuất hiện trong LangSmith
    // dưới dạng 1 lần gọi "gemini.sendMessage" duy nhất, không tạo span rác.
    const sendMessage = traceable(
      (message: string | Part[]) => this.withRetry(() => chat.sendMessage(message)),
      { name: 'gemini.sendMessage' },
    );
    const callTool = traceable(
      async (name: string, args: Record<string, unknown>) => {
        await this.emitAgentStep(dto, { type: 'tool_call', tool: name });
        const result = await this.mcpClient.callTool({ provider: dto.provider, name, args, ownerId: dto.userId });
        const text = extractTextFromMcpResult(result);
        const status: 'success' | 'error' = result.isError ? 'error' : 'success';
        const resultPreview = this.truncatePreview(text);
        await this.emitAgentStep(dto, { type: 'tool_result', tool: name, status, resultPreview });
        toolCalls.push({ tool: name, status, resultPreview });
        return text;
      },
      { name: 'mcp.callTool' },
    );

    let response = (await sendMessage(dto.prompt)).response;
    let selfChecked = false;

    for (let step = 0; step < ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS; step++) {
      const calls = response.functionCalls();
      if (!calls || calls.length === 0) {
        // Model rẻ (flash) hay dừng ngay khi vừa xong 1 tool call, kể cả khi
        // đó mới chỉ là bước khám phá cấu trúc chứ chưa có dữ liệu thật —
        // ép thêm đúng 1 lượt tự phản biện (lượt gọi model riêng, không phải
        // dựa vào model tự giác trong cùng lượt sinh câu trả lời) trước khi
        // chấp nhận đây là câu trả lời cuối. Chỉ nudge khi đã có tool call
        // (câu hỏi chat thường không cần bước này) và chỉ đúng 1 lần (tránh
        // lặp vô hạn nếu model cứ khẳng định "đã đủ").
        if (!selfChecked && toolCalls.length > 0) {
          selfChecked = true;
          response = (await sendMessage(ORCHESTRATION_SELF_CHECK_PROMPT)).response;
          continue;
        }
        return { answer: response.text() || 'Xin lỗi, mình chưa có câu trả lời phù hợp.', toolCalls };
      }

      const responseParts: Part[] = [];
      for (const call of calls) {
        const content = await callTool(call.name, call.args as Record<string, unknown>);
        responseParts.push({
          functionResponse: { name: call.name, response: { content } },
        });
      }

      response = (await sendMessage(responseParts)).response;
    }

    return { answer: response.text() || 'Xin lỗi, câu hỏi này cần nhiều bước hơn mình hỗ trợ được.', toolCalls };
  }

  /**
   * Gemini function-calling chỉ chấp nhận 1 tập con hẹp của JSON Schema —
   * loại các field chuẩn JSON Schema mà zod-to-json-schema (bên MCP server)
   * tự sinh ra nhưng Gemini không biết ("$schema", "additionalProperties"),
   * kẻo bị Gemini trả 400 "Unknown name ... Cannot find field".
   */
  private toGeminiSchema(schema: Record<string, unknown>): FunctionDeclarationSchema {
    const { $schema, additionalProperties, properties, items, ...rest } = schema;
    const cleaned: Record<string, unknown> = { ...rest };

    if (properties && typeof properties === 'object') {
      cleaned.properties = Object.fromEntries(
        Object.entries(properties as Record<string, unknown>).map(([key, value]) => [
          key,
          value && typeof value === 'object' ? this.toGeminiSchema(value as Record<string, unknown>) : value,
        ]),
      );
    }
    if (items && typeof items === 'object') {
      cleaned.items = this.toGeminiSchema(items as Record<string, unknown>);
    }

    return cleaned as unknown as FunctionDeclarationSchema;
  }

  /**
   * Gemini API bắt buộc history bắt đầu bằng role "user" và alternate liên
   * tục (không 2 turn cùng role liền nhau) — gộp các turn cùng role liền kề
   * (VD 2 message user gửi liên tiếp) và bỏ turn "model" đứng đầu (nếu có).
   */
  private toGeminiHistory(turns: ChatHistoryTurnDto[]): Content[] {
    const merged: Content[] = [];
    for (const turn of turns) {
      const last = merged[merged.length - 1];
      if (last && last.role === turn.role) {
        last.parts[0].text += `\n${turn.text}`;
      } else {
        merged.push({ role: turn.role, parts: [{ text: turn.text }] });
      }
    }
    while (merged.length > 0 && merged[0].role === 'model') {
      merged.shift();
    }
    return merged;
  }

  /** Rút gọn kết quả tool thành 1 dòng ngắn để hiện preview trong timeline FE. */
  private truncatePreview(text: string, maxLen = 200): string {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen)}…` : oneLine;
  }

  /**
   * Gemini API thỉnh thoảng trả 429 (quota) hoặc 503 (server quá tải) —
   * đều là lỗi TẠM THỜI, tự hết sau vài giây. Retry với backoff thay vì
   * fail ngay, tránh việc user phải tự hỏi lại thủ công.
   */
  private isRetryableGeminiError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\[(429|503)/.test(message) || /Too Many Requests|Service Unavailable/i.test(message);
  }

  private async withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt === maxAttempts || !this.isRetryableGeminiError(error)) {
          throw error;
        }
        const delayMs = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
        this.logger.warn(
          `Gemini call failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${(error as Error).message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    // Không bao giờ tới đây (loop luôn return hoặc throw), chỉ để TS hài lòng.
    throw new Error('withRetry: unreachable');
  }

  /**
   * Chi tiết (tool đang chạy) → chỉ vào room riêng của người trigger.
   * Signal thô (không kèm tool) → thêm vào room channel, chỉ khi channel là GROUP
   * (DIRECT chỉ có 1 người, không cần signal riêng).
   */
  private async emitAgentStep(
    dto: RunReactLoopRequestDto,
    step: {
      type: 'tool_call' | 'tool_result' | 'done';
      tool?: string;
      status?: 'success' | 'error';
      resultPreview?: string;
    },
  ): Promise<void> {
    await this.queueService.addJob(EQueueName.SOCKET_QUEUE, EJobName.EMIT_EVENT, {
      event: ESocketEvent.AGENT_STREAM,
      room: `user_${dto.userId}`,
      data: { ...step, channelId: dto.channelId, messageId: dto.messageId },
    });

    if (dto.channelType === 'group') {
      await this.queueService.addJob(EQueueName.SOCKET_QUEUE, EJobName.EMIT_EVENT, {
        event: ESocketEvent.AGENT_STREAM,
        room: dto.channelId,
        data: { type: step.type, channelId: dto.channelId, messageId: dto.messageId },
      });
    }
  }
}
