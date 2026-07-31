import { Logger } from '@nestjs/common';
import { JsonRepair } from 'agentic-io-parser';
import OpenAI from 'openai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { traceable } from 'langsmith/traceable';
import {
  LlmChatOptions,
  LlmChatSession,
  LlmToolResult,
  LlmTurnResult,
} from './llm-strategy.interface';
import { attachLlmCostMetadata } from '../llm-cost.util';

export class OpenAiChatSession implements LlmChatSession {
  private readonly logger = new Logger(OpenAiChatSession.name);
  private readonly model: string;
  private readonly temperature?: number;
  private readonly tools: ChatCompletionTool[];
  private readonly messages: ChatCompletionMessageParam[];
  // withLlmRetry gọi lại rawSend() với CÙNG input khi retry — track để không
  // đẩy trùng message vào history mỗi lần thử lại.
  private pendingInput: string | LlmToolResult[] | null = null;
  private readonly tracedSend: (
    input: string | LlmToolResult[],
    onToken?: (chunk: string) => void,
    signal?: AbortSignal,
  ) => Promise<LlmTurnResult>;

  constructor(
    private readonly client: OpenAI,
    opts: LlmChatOptions,
  ) {
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.tools = opts.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    this.messages = [
      { role: 'system', content: opts.systemInstruction },
      ...opts.history.map(
        (h): ChatCompletionMessageParam => ({
          role: h.role === 'model' ? 'assistant' : 'user',
          content: h.text,
        }),
      ),
    ];
    this.tracedSend = traceable(this.rawSend.bind(this), {
      name: 'openai.sendMessage',
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
        for (const result of input) {
          this.messages.push({
            role: 'tool',
            tool_call_id: result.id ?? result.name,
            content: result.content,
          });
        }
      }
    }

    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: this.messages,
        tools: this.tools.length > 0 ? this.tools : undefined,
        temperature: this.temperature,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal },
    );

    let fullText = '';
    const toolCallsMap: Record<number, any> = {};
    let usage:
      | {
          prompt_tokens: number;
          completion_tokens: number;
          prompt_tokens_details?: { cached_tokens?: number };
        }
      | undefined;

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = chunk.usage;
      }

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) {
        if ((chunk as any).error) {
          throw new Error(
            `9Router Stream Error: ${(chunk as any).error.message || JSON.stringify((chunk as any).error)}`,
          );
        }
        continue;
      }

      if (delta.content) {
        fullText += delta.content;
        if (onToken) {
          onToken(delta.content);
        }
      }

      if (delta.tool_calls) {
        for (const call of delta.tool_calls) {
          if (!toolCallsMap[call.index]) {
            toolCallsMap[call.index] = {
              id: call.id,
              type: 'function',
              function: { name: call.function?.name || '', arguments: '' },
            };
          }
          if (call.function?.arguments) {
            toolCallsMap[call.index].function.arguments +=
              call.function.arguments;
          }
        }
      }
    }

    const toolCalls = Object.values(toolCallsMap).map((call: any) => ({
      id: call.id,
      name: call.function.name,
      args: this.safeParseArgs(call.function.arguments),
    }));

    // abort() ở timeout không đảm bảo request cũ dừng NGAY — nếu nó vẫn tự
    // hoàn tất sau khi đã bị bỏ (lần retry khác đang chạy), KHÔNG được ghi
    // vào this.messages nữa, sẽ chen ngang phá thứ tự assistant/tool.
    if (signal?.aborted) {
      throw new Error('Aborted — request cũ đã bị bỏ do timeout/retry');
    }

    this.pendingInput = null;
    this.messages.push({
      role: 'assistant',
      content: fullText || null,
      tool_calls:
        Object.values(toolCallsMap).length > 0
          ? Object.values(toolCallsMap)
          : undefined,
    } as ChatCompletionAssistantMessageParam);

    // Giai đoạn 4, Step 7 — gắn usage/chi phí ước lượng vào trace hiện tại, giống hệt
    // generateStructured(). Bị rớt mất khi rawSend() chuyển sang streaming; stream_options
    // include_usage đưa usage về ở chunk cuối (choices rỗng) thay vì completion.usage.
    if (usage) {
      const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
      this.logger.log(
        `sendMessage() usage model=${this.model} input=${usage.prompt_tokens} cached=${cachedTokens} output=${usage.completion_tokens}`,
      );
      attachLlmCostMetadata(this.model, {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        cachedTokens,
      });
    }

    return { text: fullText, toolCalls };
  }

  private safeParseArgs(raw: string): Record<string, unknown> {
    try {
      const repair = new JsonRepair();
      const repaired = repair.repair(raw || '{}');
      const parsed = JSON.parse(repaired);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
      return {};
    } catch {
      // Model đôi khi trả JSON args không hợp lệ — đã ghi rõ rủi ro này
      // trong doc SDK OpenAI, không phải bug ở phía mình.
      return {};
    }
  }
}
