import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  MessageParam,
  Tool,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { traceable } from 'langsmith/traceable';
import { ORCHESTRATION_ERROR } from '@slack/constants';
import {
  LlmChatOptions,
  LlmChatSession,
  LlmStrategy,
  LlmStructuredOptions,
  LlmToolResult,
  LlmTurnResult,
} from './llm-strategy.interface';
import { attachLlmCostMetadata } from '../llm-cost.util';

// Claude không có tham số tuỳ chọn cho max_tokens như Gemini/OpenAI — SDK
// bắt buộc truyền, không có default hợp lý cho mọi model nên set cứng 1
// giá trị đủ dùng cho câu trả lời text + vài tool-call.
const MAX_TOKENS = 4096;

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

class AnthropicChatSession implements LlmChatSession {
  private readonly model: string;
  private readonly temperature?: number;
  private readonly tools: Tool[];
  private readonly system: string;
  private readonly messages: MessageParam[];
  private readonly tracedSend: (
    input: string | LlmToolResult[],
    onToken?: (chunk: string) => void,
    signal?: AbortSignal,
  ) => Promise<LlmTurnResult>;

  constructor(
    private readonly client: Anthropic,
    opts: LlmChatOptions,
  ) {
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.system = opts.systemInstruction;
    this.tools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Tool.InputSchema,
    }));
    this.messages = opts.history.map((h) => ({
      role: h.role === 'model' ? 'assistant' : 'user',
      content: h.text,
    }));
    this.tracedSend = traceable(this.rawSend.bind(this), {
      name: 'anthropic.sendMessage',
      run_type: 'llm',
    }) as (
      input: string | LlmToolResult[],
      onToken?: (chunk: string) => void,
      signal?: AbortSignal,
    ) => Promise<LlmTurnResult>;
  }

  sendMessage(
    input: string | LlmToolResult[],
    onToken?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<LlmTurnResult> {
    return this.tracedSend(input, onToken, signal);
  }

  private async rawSend(
    input: string | LlmToolResult[],
    onToken?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<LlmTurnResult> {
    if (typeof input === 'string') {
      this.messages.push({ role: 'user', content: input });
    } else {
      this.messages.push({
        role: 'user',
        content: input.map((r) => ({
          type: 'tool_result' as const,
          tool_use_id: r.id ?? r.name,
          content: r.content,
        })),
      });
    }

    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: 'text',
            text: this.system,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: this.messages,
        tools: this.tools.length > 0 ? this.tools : undefined,
        temperature: this.temperature,
      },
      { signal },
    );

    if (onToken) {
      stream.on('text', (textDelta) => onToken(textDelta));
    }

    const message = await stream.finalMessage();

    if (message.usage) {
      attachLlmCostMetadata(this.model, {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      });
    }

    // Lưu lại đúng content block Claude vừa trả (text + tool_use) làm turn
    // "assistant" — bắt buộc phải có trong history thì tool_result gửi ở
    // lượt sau mới khớp đúng tool_use_id tương ứng.
    this.messages.push({
      role: 'assistant',
      content: message.content as ContentBlockParam[],
    });

    const text = message.content
      .filter(
        (block): block is Extract<typeof block, { type: 'text' }> =>
          block.type === 'text',
      )
      .map((block) => block.text)
      .join('\n');

    const toolCalls = message.content
      .filter((block): block is ToolUseBlock => block.type === 'tool_use')
      .map((block) => ({
        id: block.id,
        name: block.name,
        args: (block.input ?? {}) as Record<string, unknown>,
      }));

    return { text, toolCalls };
  }
}
