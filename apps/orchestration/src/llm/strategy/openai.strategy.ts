import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { JsonExtractor, JsonRepair } from 'agentic-io-parser';
import OpenAI from 'openai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
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

// 9Router đôi khi gắn nhầm terminator SSE "data: [DONE]" vào cuối 1 response
// JSON bình thường (không streaming), và đôi khi double-stringify cả body.
// Chuỗi "[DONE]" tự chứa ký tự `[`/`]` nên bộ dò ngoặc của JsonExtractor dễ
// nhận nhầm nó là 1 phần cấu trúc JSON — phải dọn rác này TRƯỚC khi extract/parse.
function stripNineRouterArtifacts(rawText: string): string {
  let text = rawText.replace(/data:\s*\[DONE\]\s*$/g, '').trim();

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') {
      text = parsed;
    }
  } catch {
    // Không phải double-stringified, giữ nguyên text.
  }

  return text;
}

@Injectable()
export class OpenAiStrategy implements LlmStrategy {
  readonly id = 'openai';
  private readonly logger = new Logger(OpenAiStrategy.name);
  private readonly client?: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      const baseURL =
        process.env.AI_ROUTER_URL || 'http://slack-9router:20128/v1';
      this.client = new OpenAI({
        apiKey,
        baseURL, // Trỏ thẳng vào 9Router chạy qua Docker
        maxRetries: 3,
        fetch: async (
          url: RequestInfo,
          init?: RequestInit,
        ): Promise<Response> => {
          const response = await fetch(url, init);

          // Bỏ qua nếu là stream (vì stream chunk được xử lý riêng rẽ)
          const isStream =
            init?.body &&
            typeof init.body === 'string' &&
            init.body.includes('"stream":true');
          if (isStream) {
            return response;
          }

          // KHÔNG dựa vào header content-type 9Router trả về để quyết định có dọn
          // rác hay không — 9Router có lúc gắn content-type kiểu SSE (text/event-stream)
          // cho cả request non-stream, khiến bước dọn rác bị bỏ qua đúng lúc cần nhất.
          const text = await response.text();
          return new Response(stripNineRouterArtifacts(text), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        },
      });
    } else {
      this.logger.warn(
        'OPENAI_API_KEY is not defined in environment variables',
      );
    }
  }

  startChat(opts: LlmChatOptions): LlmChatSession {
    if (!this.client) {
      throw new RpcException(ORCHESTRATION_ERROR.LLM_PROVIDER_NOT_CONFIGURED);
    }
    return new OpenAiChatSession(this.client, opts);
  }

  async generateStructured<T>(opts: LlmStructuredOptions): Promise<T> {
    if (!this.client) {
      throw new RpcException(ORCHESTRATION_ERROR.LLM_PROVIDER_NOT_CONFIGURED);
    }

    const generate = traceable(
      async (params: {
        model: string;
        systemInstruction: string;
        prompt: string;
        schema: Record<string, unknown>;
      }) => {
        let completion = (await this.client!.chat.completions.create(
          {
            model: params.model,
            messages: [
              { role: 'system', content: params.systemInstruction },
              { role: 'user', content: params.prompt },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'decision', schema: params.schema },
            },
            temperature: 0,
          },
          { signal: opts.signal },
        )) as any;

        if (typeof completion === 'string' || completion instanceof String) {
          try {
            const extractor = new JsonExtractor();
            // Dọn rác 9Router trước — "[DONE]" tự chứa dấu ngoặc nên nếu để lọt
            // vào extractor, nó đánh lừa bộ dò ngoặc và làm JSON.parse fail.
            const cleanRaw = extractor.extract(
              stripNineRouterArtifacts(completion.toString()),
            );
            completion = JSON.parse(cleanRaw);
          } catch (e) {
            // ignore, let it fail below
            this.logger.error('OpenAI Error: Failed to parse completion', e);
          }
        }

        // Giai đoạn 4, Step 7 — gắn usage/chi phí ước lượng vào chính trace
        // "openai.generateStructured" này (bên trong hàm traceable() bọc).
        if (completion.usage) {
          attachLlmCostMetadata(params.model, {
            inputTokens: completion.usage.prompt_tokens,
            outputTokens: completion.usage.completion_tokens,
          });
        }
        return completion;
      },
      { name: 'openai.generateStructured', run_type: 'llm' },
    );

    const completion = await generate(opts);

    if (!completion || !completion.choices) {
      throw new Error(`9Router/OpenAI Error: ${JSON.stringify(completion)}`);
    }

    const text = completion.choices[0]?.message?.content ?? '{}';
    const extractor = new JsonExtractor();
    const cleanJson = extractor.extract(text);

    return JSON.parse(cleanJson) as T;
  }
}

class OpenAiChatSession implements LlmChatSession {
  private readonly model: string;
  private readonly temperature?: number;
  private readonly tools: ChatCompletionTool[];
  private readonly messages: ChatCompletionMessageParam[];
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
    let usage: { prompt_tokens: number; completion_tokens: number } | undefined;

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
      attachLlmCostMetadata(this.model, {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
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
