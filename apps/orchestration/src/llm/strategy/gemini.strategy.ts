import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { JsonExtractor } from 'agentic-io-parser';
import {
  GoogleGenerativeAI,
  type Content,
  type FunctionDeclarationSchema,
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
} from './llm-strategy.interface';
import { attachLlmCostMetadata } from '../llm-cost.util';
import { withGeminiRetry } from './gemini-retry.util';
import { GeminiChatSession } from './gemini-chat-session';

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
      this.logger.warn(
        'GEMINI_API_KEY is not defined in environment variables',
      );
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

    const requestOptions = {
      baseUrl: process.env.AI_ROUTER_URL
        ? process.env.AI_ROUTER_URL.replace(/\/v1$/, '')
        : 'http://slack-9router:20128',
    };

    const model = this.genAI.getGenerativeModel(
      {
        model: opts.model,
        tools,
        systemInstruction: opts.systemInstruction,
        generationConfig:
          opts.temperature !== undefined
            ? { temperature: opts.temperature }
            : undefined,
      },
      requestOptions,
    );
    const chat = model.startChat({
      history: this.toGeminiHistory(opts.history),
    });

    return new GeminiChatSession(chat, this.logger, opts.model);
  }

  async generateStructured<T>(opts: LlmStructuredOptions): Promise<T> {
    if (!this.genAI) {
      throw new RpcException(ORCHESTRATION_ERROR.LLM_PROVIDER_NOT_CONFIGURED);
    }

    const requestOptions = {
      baseUrl: process.env.AI_ROUTER_URL
        ? process.env.AI_ROUTER_URL.replace(/\/v1$/, '')
        : 'http://slack-9router:20128',
    };

    const model = this.genAI.getGenerativeModel(
      {
        model: opts.model,
        systemInstruction: opts.systemInstruction,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: this.toGeminiSchema(opts.schema) as never,
          temperature: 0,
        },
      },
      requestOptions,
    );

    const generate = traceable(
      async (prompt: string) => {
        const result = await withGeminiRetry(
          () => model.generateContent(prompt, { signal: opts.signal }),
          this.logger,
          3,
          opts.signal,
        );
        // Giai đoạn 4, Step 7 — gắn usage/chi phí ước lượng vào chính trace
        // "gemini.generateStructured" này (bên trong hàm traceable() bọc).
        const usage = result.response.usageMetadata;
        if (usage) {
          attachLlmCostMetadata(opts.model, {
            inputTokens: usage.promptTokenCount ?? 0,
            outputTokens: usage.candidatesTokenCount ?? 0,
          });
        }
        return result;
      },
      { name: 'gemini.generateStructured', run_type: 'llm' },
    );
    const result = await generate(opts.prompt);
    const text = result.response.text();
    const extractor = new JsonExtractor();
    const cleanJson = extractor.extract(text);

    return JSON.parse(cleanJson) as T;
  }

  /**
   * Gemini function-calling/structured-output chỉ chấp nhận 1 tập con hẹp
   * của JSON Schema — loại các field chuẩn mà nguồn schema (zod-to-json-schema
   * hoặc tay viết) có thể sinh ra nhưng Gemini không biết ("$schema",
   * "additionalProperties"), kẻo bị Gemini trả 400 "Unknown name".
   */
  private toGeminiSchema(
    schema: Record<string, unknown>,
  ): FunctionDeclarationSchema {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- lấy ra để LOẠI khỏi `rest`, không cần dùng trực tiếp.
    const { $schema, additionalProperties, properties, items, ...rest } =
      schema;
    const cleaned: Record<string, unknown> = { ...rest };

    // Gemini bắt buộc enum string phải có thêm "format: enum" (EnumStringSchema)
    // — JSON Schema chuẩn (OpenAI/Anthropic dùng) chỉ cần "enum", không cần field
    // này. Tự thêm ở đây để schema gọi vào LlmStrategy luôn viết dạng chuẩn,
    // không phải biết trước sẽ chạy trên Gemini hay provider khác.
    if (
      cleaned.type === 'string' &&
      Array.isArray(cleaned.enum) &&
      !cleaned.format
    ) {
      cleaned.format = 'enum';
    }

    if (properties && typeof properties === 'object') {
      cleaned.properties = Object.fromEntries(
        Object.entries(properties as Record<string, unknown>).map(
          ([key, value]) => [
            key,
            value && typeof value === 'object'
              ? this.toGeminiSchema(value as Record<string, unknown>)
              : value,
          ],
        ),
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
