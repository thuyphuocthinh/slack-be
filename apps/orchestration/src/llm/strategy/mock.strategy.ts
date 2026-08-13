import { Injectable, Logger } from '@nestjs/common';
import {
  LlmChatOptions,
  LlmChatSession,
  LlmStrategy,
  LlmStructuredOptions,
} from './llm-strategy.interface';
import { MockChatSession } from './mock-chat-session';

// LOAD_TEST_MODE — thay CẢ 4 lời gọi LLM (plan/evaluate/synthesize/ReactLoop)
// bằng mock này (xem LlmStrategyFactory.resolve()), để load test đo được
// throughput/concurrency THẬT của hạ tầng (BullMQ queue, MCP client, circuit
// breaker) mà không tốn tiền/bị rate-limit bởi provider LLM thật.
//
// "agent"/"tool" KHÔNG được hard-code — phải trỏ tới 1 agent THẬT đã kết nối
// trong workspace test (LOAD_TEST_AGENT_PROVIDER, mặc định "sql_server"),
// nếu không plan() sẽ trả về agent không tồn tại, bị continueRounds() chặn
// ngay ("Mình chưa thể xử lý yêu cầu này...") — không chạm được tới
// ReactLoop/MCP/queue nào cả, load test coi như vô nghĩa.
@Injectable()
export class MockStrategy implements LlmStrategy {
  readonly id = 'mock';
  private readonly logger = new Logger(MockStrategy.name);

  private get mockAgentProvider(): string {
    return process.env.LOAD_TEST_AGENT_PROVIDER || 'sql_server';
  }

  startChat(opts: LlmChatOptions): LlmChatSession {
    this.logger.log(
      `startChat (LOAD_TEST_MODE) with ${opts.tools.length} tools`,
    );
    return new MockChatSession(opts.tools);
  }

  async generateStructured<T>(opts: LlmStructuredOptions): Promise<T> {
    this.logger.log('generateStructured (LOAD_TEST_MODE)');
    await new Promise((resolve) => setTimeout(resolve, 500));

    // SUPERVISOR_EVALUATE_SCHEMA(_NO_DONE) có field "verdict" — mọi schema
    // của plan() (có/không "answer") đều không có field này.
    if ('verdict' in (opts.schema.properties as Record<string, unknown>)) {
      return { verdict: 'done' } as unknown as T;
    }

    return {
      action: 'plan',
      steps: [
        {
          agent: this.mockAgentProvider,
          task: 'Load test: gọi 1 tool bất kỳ rồi trả lời',
          mustExecute: true,
        },
      ],
    } as unknown as T;
  }
}
