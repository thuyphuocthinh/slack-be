import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
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

@Injectable()
export class OpenAiStrategy implements LlmStrategy {
  readonly id = 'openai';
  private readonly logger = new Logger(OpenAiStrategy.name);
  private readonly client?: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY || 'fake-key';
    if (apiKey) {
      const baseURL = process.env.AI_ROUTER_URL || 'http://slack-9router:20128/v1';
      this.client = new OpenAI({
        apiKey,
        baseURL, // Trỏ thẳng vào 9Router chạy qua Docker
        maxRetries: 3,
        fetch: async (url: RequestInfo, init?: RequestInit): Promise<Response> => {
          const response = await fetch(url, init);
          
          // Bỏ qua nếu là stream (vì stream chunk được xử lý riêng rẽ)
          const isStream = init?.body && typeof init.body === 'string' && init.body.includes('"stream":true');
          
          // Nếu là API gọi bình thường, ta chặn luồng HTTP response lại để dọn rác do 9Router sinh ra
          if (!isStream && response.headers.get('content-type')?.includes('application/json')) {
            let text = await response.text();
            
            // 1. Dọn rác `data: [DONE]` do 9Router gắn nhầm vào cuối response
            text = text.replace(/data:\s*\[DONE\]\s*$/g, '').trim();
            
            // 2. Dọn lỗi double-stringified (chuỗi JSON bị mã hoá thành string 2 lần)
            try {
              const parsed = JSON.parse(text);
              if (typeof parsed === 'string') {
                text = parsed;
              }
            } catch (e) {
              // Bỏ qua nếu parse lỗi, giữ nguyên text gốc
            }

            return new Response(text, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            });
          }
          return response;
        }
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
        const completion = await this.client!.chat.completions.create({
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
        });
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

    let completion = await generate(opts) as any;

    if (typeof completion === 'string' || completion instanceof String) {
      const rawStr = completion.toString();
      // Extract the JSON object ignoring any prefixes, suffixes, quotes, or SSE garbage
      const match = rawStr.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          completion = JSON.parse(match[0]);
        } catch (e) {
          throw new Error(`9Router parsing error: Unable to parse extracted JSON. Raw: ${rawStr}`);
        }
      }
    }

    if (!completion || !completion.choices) {
      throw new Error(`9Router/OpenAI Error: ${JSON.stringify(completion)}`);
    }
    
    const text = completion.choices[0]?.message?.content ?? '{}';
    let cleanJson = text.trim();
    
    // Dọn rác Markdown nếu LLM hallucinate (trả về ```json thay vì JSON thuần)
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.replace(/^```json\n?/, '').replace(/```$/, '').trim();
    } else if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```\n?/, '').replace(/```$/, '').trim();
    }
    
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
    }) as (input: string | LlmToolResult[], onToken?: (chunk: string) => void) => Promise<LlmTurnResult>;
  }

  sendMessage(
    input: string | LlmToolResult[],
    onToken?: (chunk: string) => void,
  ): Promise<LlmTurnResult> {
    return this.tracedSend(input, onToken);
  }

  private async rawSend(
    input: string | LlmToolResult[],
    onToken?: (chunk: string) => void,
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

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: this.messages,
      tools: this.tools.length > 0 ? this.tools : undefined,
      temperature: this.temperature,
      stream: true,
    });

    let fullText = '';
    const toolCallsMap: Record<number, any> = {};

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) {
        if ((chunk as any).error) {
          throw new Error(`9Router Stream Error: ${(chunk as any).error.message || JSON.stringify((chunk as any).error)}`);
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
            toolCallsMap[call.index] = { id: call.id, type: 'function', function: { name: call.function?.name || '', arguments: '' } };
          }
          if (call.function?.arguments) {
            toolCallsMap[call.index].function.arguments += call.function.arguments;
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
      tool_calls: Object.values(toolCallsMap).length > 0 ? Object.values(toolCallsMap) : undefined,
    } as ChatCompletionAssistantMessageParam);

    return { text: fullText, toolCalls };
  }

  private safeParseArgs(raw: string): Record<string, unknown> {
    try {
      return JSON.parse(raw || '{}');
    } catch {
      // Model đôi khi trả JSON args không hợp lệ — đã ghi rõ rủi ro này
      // trong doc SDK OpenAI, không phải bug ở phía mình.
      return {};
    }
  }
}
