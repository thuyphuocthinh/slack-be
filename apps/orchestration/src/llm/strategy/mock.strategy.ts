import { Injectable, Logger } from '@nestjs/common';
import {
  LlmChatOptions,
  LlmChatSession,
  LlmStrategy,
  LlmStructuredOptions,
  LlmToolResult,
  LlmTurnResult,
} from './llm-strategy.interface';

@Injectable()
export class MockStrategy implements LlmStrategy {
  readonly id = 'mock';
  private readonly logger = new Logger(MockStrategy.name);

  startChat(opts: LlmChatOptions): LlmChatSession {
    this.logger.log(`startChat (LOAD_TEST_MODE) with ${opts.tools.length} tools`);
    return new MockChatSession();
  }

  async generateStructured<T>(opts: LlmStructuredOptions): Promise<T> {
    this.logger.log('generateStructured (LOAD_TEST_MODE)');
    // Giả lập độ trễ LLM
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    // Trả về mock decision để Supervisor bắt buộc gọi sang ReactLoop (test streaming)
    return {
      action: 'delegate',
      delegations: [
        { agent: 'mock_agent', task: 'Hãy fake một bài blog dài' }
      ]
    } as unknown as T;
  }
}

class MockChatSession implements LlmChatSession {
  private step = 0;

  async sendMessage(
    input: string | LlmToolResult[],
    onToken?: (chunk: string) => void,
  ): Promise<LlmTurnResult> {
    // Giả lập thời gian suy nghĩ của LLM
    await new Promise((resolve) => setTimeout(resolve, 500));
    this.step++;

    if (this.step === 1) {
       // Lượt 1: LLM quyết định gọi tool (để load test đập vào hệ thống tool call)
       // Trả về tool_call thay vì answer luôn
       return {
         text: '',
         toolCalls: [
           { id: 'mock-1', name: 'mock_tool_1', args: {} }
         ]
       }
    }

    // Lượt cuối: LLM trả lời thật (có stream nếu được yêu cầu)
    const finalAnswer = 'Đã hoàn tất load test bằng Mock LLM! Hệ thống hoạt động siêu mượt.';
    
    if (onToken) {
      const parts = finalAnswer.split(' ');
      for (const p of parts) {
        onToken(p + ' ');
        // Giả lập streaming từng chữ một
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }

    return {
      text: finalAnswer,
      toolCalls: [],
    };
  }
}
