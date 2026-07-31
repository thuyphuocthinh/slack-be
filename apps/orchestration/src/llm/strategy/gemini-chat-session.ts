import { Logger } from '@nestjs/common';
import { type ChatSession, type Part } from '@google/generative-ai';
import { traceable } from 'langsmith/traceable';
import {
  LlmChatSession,
  LlmToolResult,
  LlmTurnResult,
} from './llm-strategy.interface';
import { attachLlmCostMetadata } from '../llm-cost.util';
import { withGeminiRetry } from './gemini-retry.util';

export class GeminiChatSession implements LlmChatSession {
  private readonly tracedSend: (
    input: string | LlmToolResult[],
    onToken?: (chunk: string) => void,
    signal?: AbortSignal,
  ) => Promise<LlmTurnResult>;

  constructor(
    private readonly chat: ChatSession,
    private readonly logger: Logger,
    private readonly model: string,
  ) {
    this.tracedSend = traceable(this.rawSend.bind(this), {
      name: 'gemini.sendMessage',
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
    const message: string | Part[] =
      typeof input === 'string'
        ? input
        : input.map((r) => ({
            functionResponse: {
              name: r.name,
              response: { content: r.content },
            },
          }));

    const result = await withGeminiRetry(
      () => this.chat.sendMessageStream(message, { signal }),
      this.logger,
      3,
      signal,
    );

    let fullText = '';
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        fullText += chunkText;
        if (onToken) onToken(chunkText);
      }
    }

    const response = await result.response;
    const calls = response.functionCalls() ?? [];

    const usage = response.usageMetadata;
    if (usage) {
      attachLlmCostMetadata(this.model, {
        inputTokens: usage.promptTokenCount ?? 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
      });
    }

    return {
      text: fullText,
      toolCalls: calls.map((c) => ({
        name: c.name,
        args: c.args as Record<string, unknown>,
      })),
    };
  }
}
