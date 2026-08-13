import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import Anthropic from '@anthropic-ai/sdk';
import type { Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import { traceable } from 'langsmith/traceable';
import { ORCHESTRATION_ERROR } from '@slack/constants';
import {
  LlmChatOptions,
  LlmChatSession,
  LlmStrategy,
  LlmStructuredOptions,
} from './llm-strategy.interface';
import { attachLlmCostMetadata } from '../llm-cost.util';
import { AnthropicChatSession, MAX_TOKENS } from './anthropic-chat-session';

@Injectable()
export class AnthropicStrategy implements LlmStrategy {
  readonly id = 'anthropic';
  private readonly logger = new Logger(AnthropicStrategy.name);
  private readonly client?: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      const baseURL =
        process.env.AI_ROUTER_URL || 'http://slack-9router:20128/v1';
      // maxRetries: SDK tự retry lỗi tạm thời (429/5xx) với backoff, giống OpenAI.
      this.client = new Anthropic({ apiKey, baseURL, maxRetries: 3 });
    } else {
      this.logger.warn(
        'ANTHROPIC_API_KEY is not defined in environment variables',
      );
    }
  }

  startChat(opts: LlmChatOptions): LlmChatSession {
    if (!this.client) {
      throw new RpcException(ORCHESTRATION_ERROR.LLM_PROVIDER_NOT_CONFIGURED);
    }
    return new AnthropicChatSession(this.client, opts);
  }

  async generateStructured<T>(opts: LlmStructuredOptions): Promise<T> {
    if (!this.client) {
      throw new RpcException(ORCHESTRATION_ERROR.LLM_PROVIDER_NOT_CONFIGURED);
    }

    // Claude không có "response_format" JSON như OpenAI — ép cấu trúc bằng
    // cách bắt model bắt buộc gọi đúng 1 tool giả có input_schema = schema
    // mong muốn, rồi đọc "input" của tool_use block đó ra làm kết quả.
    const decisionTool: Tool = {
      name: 'decision',
      description: 'Kết quả quyết định, PHẢI gọi tool này để trả lời.',
      input_schema: opts.schema as Tool.InputSchema,
    };

    const generate = traceable(
      async (params: {
        model: string;
        systemInstruction: string;
        prompt: string;
      }) => {
        const message = await this.client!.messages.create(
          {
            model: params.model,
            max_tokens: MAX_TOKENS,
            system: params.systemInstruction,
            messages: [{ role: 'user', content: params.prompt }],
            tools: [decisionTool],
            tool_choice: { type: 'tool', name: 'decision' },
            // Ưu tiên nhất quán routing hơn sáng tạo — giống Gemini/OpenAI
            // (Giai đoạn 2, Step 5: giảm rủi ro Supervisor tự "sáng tạo" số
            // liệu khi soạn task/answer từ kết quả vòng trước).
            temperature: 0,
          },
          { signal: opts.signal },
        );
        // Giai đoạn 4, Step 7 — gắn usage/chi phí ước lượng vào chính trace
        // "anthropic.generateStructured" này (bên trong hàm traceable() bọc).
        if (message.usage) {
          attachLlmCostMetadata(params.model, {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
          });
        }
        return message;
      },
      { name: 'anthropic.generateStructured', run_type: 'llm' },
    );

    const message = await generate(opts);
    const toolUse = message.content.find(
      (block): block is ToolUseBlock => block.type === 'tool_use',
    );
    return (toolUse?.input ?? {}) as T;
  }
}
