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

@Injectable()
export class OpenAiStrategy implements LlmStrategy {
  readonly id = 'openai';
  private readonly logger = new Logger(OpenAiStrategy.name);
  private readonly client?: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      // maxRetries: SDK tự retry 429/5xx với backoff — không cần tự viết
      // lại retry loop như bên GeminiStrategy (SDK Gemini không có sẵn cái này).
      this.client = new OpenAI({ apiKey, maxRetries: 3 });
    } else {
      this.logger.warn('OPENAI_API_KEY is not defined in environment variables');
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
      (params: { model: string; systemInstruction: string; prompt: string; schema: Record<string, unknown> }) =>
        this.client!.chat.completions.create({
          model: params.model,
          messages: [
            { role: 'system', content: params.systemInstruction },
            { role: 'user', content: params.prompt },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'decision', schema: params.schema } },
          temperature: 0,
        }),
      { name: 'openai.generateStructured' },
    );

    const completion = await generate(opts);
    const text = completion.choices[0]?.message?.content ?? '{}';
    return JSON.parse(text) as T;
  }
}

class OpenAiChatSession implements LlmChatSession {
  private readonly model: string;
  private readonly temperature?: number;
  private readonly tools: ChatCompletionTool[];
  private readonly messages: ChatCompletionMessageParam[];
  private readonly tracedSend: (input: string | LlmToolResult[]) => Promise<LlmTurnResult>;

  constructor(
    private readonly client: OpenAI,
    opts: LlmChatOptions,
  ) {
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.tools = opts.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    this.messages = [
      { role: 'system', content: opts.systemInstruction },
      ...opts.history.map(
        (h): ChatCompletionMessageParam => ({ role: h.role === 'model' ? 'assistant' : 'user', content: h.text }),
      ),
    ];
    this.tracedSend = traceable(this.rawSend.bind(this), { name: 'openai.sendMessage' }) as (input: string | LlmToolResult[]) => Promise<LlmTurnResult>;
  }

  sendMessage(input: string | LlmToolResult[]): Promise<LlmTurnResult> {
    return this.tracedSend(input);
  }

  private async rawSend(input: string | LlmToolResult[]): Promise<LlmTurnResult> {
    if (typeof input === 'string') {
      this.messages.push({ role: 'user', content: input });
    } else {
      for (const result of input) {
        this.messages.push({ role: 'tool', tool_call_id: result.id ?? result.name, content: result.content });
      }
    }

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: this.messages,
      tools: this.tools.length > 0 ? this.tools : undefined,
      temperature: this.temperature,
    });

    const message = completion.choices[0].message;
    this.messages.push(message as ChatCompletionAssistantMessageParam);

    const toolCalls = (message.tool_calls ?? [])
      .filter((call) => call.type === 'function')
      .map((call) => ({
        id: call.id,
        name: call.function.name,
        args: this.safeParseArgs(call.function.arguments),
      }));

    return { text: message.content ?? '', toolCalls };
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
