import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  GoogleGenerativeAI,
  type ChatSession,
  type Content,
  type FunctionDeclarationSchema,
  type Part,
  type Tool,
} from '@google/generative-ai';
import { traceable } from 'langsmith/traceable';
import { ORCHESTRATION_ERROR } from '@slack/constants';
import {
  LlmChatOptions,
  LlmChatSession,
  LlmHistoryTurn,
  LlmStrategy,
  LlmStructuredOptions,
  LlmToolResult,
  LlmTurnResult,
} from './llm-strategy.interface';

/**
 * Gemini API thỉnh thoảng trả 429 (quota) hoặc 503 (server quá tải) — đều
 * là lỗi TẠM THỜI, tự hết sau vài giây. Dùng chung cho MỌI lời gọi Gemini
 * (chat lẫn structured output) — SDK Gemini không có retry built-in như
 * OpenAI/Anthropic SDK, phải tự viết, nhưng chỉ viết đúng 1 chỗ.
 */
function isRetryableGeminiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\[(429|503)/.test(message) || /Too Many Requests|Service Unavailable/i.test(message);
}

async function withGeminiRetry<T>(fn: () => Promise<T>, logger: Logger, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableGeminiError(error)) {
        throw error;
      }
      const delayMs = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
      logger.warn(
        `Gemini call failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${(error as Error).message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('withGeminiRetry: unreachable');
}

@Injectable()
export class GeminiStrategy implements LlmStrategy {
  readonly id = 'gemini';
  private readonly logger = new Logger(GeminiStrategy.name);
  private readonly genAI?: GoogleGenerativeAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    } else {
      this.logger.warn('GEMINI_API_KEY is not defined in environment variables');
    }
  }

  startChat(opts: LlmChatOptions): LlmChatSession {
    if (!this.genAI) {
      throw new RpcException(ORCHESTRATION_ERROR.LLM_PROVIDER_NOT_CONFIGURED);
    }

    const tools: Tool[] = [
      {
        functionDeclarations: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: this.toGeminiSchema(t.parameters),
        })),
      },
    ];

    const model = this.genAI.getGenerativeModel({
      model: opts.model,
      tools,
      systemInstruction: opts.systemInstruction,
      generationConfig: opts.temperature !== undefined ? { temperature: opts.temperature } : undefined,
    });
    const chat = model.startChat({ history: this.toGeminiHistory(opts.history) });

    return new GeminiChatSession(chat, this.logger);
  }

  async generateStructured<T>(opts: LlmStructuredOptions): Promise<T> {
    if (!this.genAI) {
      throw new RpcException(ORCHESTRATION_ERROR.LLM_PROVIDER_NOT_CONFIGURED);
    }

    const model = this.genAI.getGenerativeModel({
      model: opts.model,
      systemInstruction: opts.systemInstruction,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: this.toGeminiSchema(opts.schema) as never,
        temperature: 0,
      },
    });

    const generate = traceable((prompt: string) => withGeminiRetry(() => model.generateContent(prompt), this.logger), {
      name: 'gemini.generateStructured',
    });
    const result = await generate(opts.prompt);
    return JSON.parse(result.response.text()) as T;
  }

  /**
   * Gemini function-calling/structured-output chỉ chấp nhận 1 tập con hẹp
   * của JSON Schema — loại các field chuẩn mà nguồn schema (zod-to-json-schema
   * hoặc tay viết) có thể sinh ra nhưng Gemini không biết ("$schema",
   * "additionalProperties"), kẻo bị Gemini trả 400 "Unknown name".
   */
  private toGeminiSchema(schema: Record<string, unknown>): FunctionDeclarationSchema {
    const { $schema, additionalProperties, properties, items, ...rest } = schema;
    const cleaned: Record<string, unknown> = { ...rest };

    // Gemini bắt buộc enum string phải có thêm "format: enum" (EnumStringSchema)
    // — JSON Schema chuẩn (OpenAI/Anthropic dùng) chỉ cần "enum", không cần field
    // này. Tự thêm ở đây để schema gọi vào LlmStrategy luôn viết dạng chuẩn,
    // không phải biết trước sẽ chạy trên Gemini hay provider khác.
    if (cleaned.type === 'string' && Array.isArray(cleaned.enum) && !cleaned.format) {
      cleaned.format = 'enum';
    }

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
   * và bỏ turn "model" đứng đầu (nếu có).
   */
  private toGeminiHistory(turns: LlmHistoryTurn[]): Content[] {
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
}

class GeminiChatSession implements LlmChatSession {
  private readonly tracedSend: (input: string | LlmToolResult[]) => Promise<LlmTurnResult>;

  constructor(
    private readonly chat: ChatSession,
    private readonly logger: Logger,
  ) {
    this.tracedSend = traceable(this.rawSend.bind(this), { name: 'gemini.sendMessage' }) as (
      input: string | LlmToolResult[],
    ) => Promise<LlmTurnResult>;
  }

  sendMessage(input: string | LlmToolResult[]): Promise<LlmTurnResult> {
    return this.tracedSend(input);
  }

  private async rawSend(input: string | LlmToolResult[]): Promise<LlmTurnResult> {
    const message: string | Part[] =
      typeof input === 'string'
        ? input
        : input.map((r) => ({ functionResponse: { name: r.name, response: { content: r.content } } }));

    const result = await withGeminiRetry(() => this.chat.sendMessage(message), this.logger);
    const response = result.response;
    const calls = response.functionCalls() ?? [];

    return {
      text: response.text() || '',
      toolCalls: calls.map((c) => ({ name: c.name, args: c.args as Record<string, unknown> })),
    };
  }
}
