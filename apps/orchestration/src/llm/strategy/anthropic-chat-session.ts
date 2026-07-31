import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  MessageParam,
  Tool,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { traceable } from 'langsmith/traceable';
import {
  LlmChatOptions,
  LlmChatSession,
  LlmToolResult,
  LlmTurnResult,
} from './llm-strategy.interface';
import { attachLlmCostMetadata } from '../llm-cost.util';

// Claude không có tham số tuỳ chọn cho max_tokens như Gemini/OpenAI — SDK
// bắt buộc truyền, không có default hợp lý cho mọi model nên set cứng 1
// giá trị đủ dùng cho câu trả lời text + vài tool-call.
export const MAX_TOKENS = 4096;

export class AnthropicChatSession implements LlmChatSession {
  private readonly model: string;
  private readonly temperature?: number;
  private readonly tools: Tool[];
  private readonly system: string;
  private readonly messages: MessageParam[];
  // withLlmRetry gọi lại rawSend() với CÙNG input khi retry — track để không
  // đẩy trùng message vào history mỗi lần thử lại (2 tool_result cùng
  // tool_use_id sẽ vi phạm ràng buộc role-alternation của Anthropic).
  private pendingInput: string | LlmToolResult[] | null = null;
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
    if (input !== this.pendingInput) {
      this.pendingInput = input;
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

    // abort() ở timeout không đảm bảo request cũ dừng NGAY — nếu nó vẫn tự
    // hoàn tất sau khi đã bị bỏ (lần retry khác đang chạy), KHÔNG được ghi
    // vào this.messages nữa, sẽ chen ngang phá thứ tự assistant/tool_result.
    if (signal?.aborted) {
      throw new Error('Aborted — request cũ đã bị bỏ do timeout/retry');
    }

    // Lưu lại đúng content block Claude vừa trả (text + tool_use) làm turn
    // "assistant" — bắt buộc phải có trong history thì tool_result gửi ở
    // lượt sau mới khớp đúng tool_use_id tương ứng.
    this.pendingInput = null;
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
