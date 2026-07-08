import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { LLM_MODEL_REGISTRY, ORCHESTRATION_ERROR, type LlmStrategyId } from '@slack/constants';
import { GeminiStrategy } from './gemini.strategy';
import { OpenAiStrategy } from './openai.strategy';
import { AnthropicStrategy } from './anthropic.strategy';
import { MockStrategy } from './mock.strategy';
import { LlmStrategy } from './llm-strategy.interface';

/**
 * Strategy Pattern — 1 điểm truy cập duy nhất để lấy đúng LlmStrategy +
 * tên model thật theo "model id" người dùng chọn (VD 'gemini-2.0-flash',
 * 'gpt-4o-mini', 'claude-haiku'). `ReactLoopService`/`SupervisorService`
 * chỉ gọi `resolve(modelId)`, không tự biết/import SDK provider nào.
 */
@Injectable()
export class LlmStrategyFactory {
  private readonly strategies: Record<LlmStrategyId | 'mock', LlmStrategy>;

  constructor(
    private readonly gemini: GeminiStrategy,
    private readonly openai: OpenAiStrategy,
    private readonly anthropic: AnthropicStrategy,
    private readonly mock: MockStrategy,
  ) {
    this.strategies = { gemini: this.gemini, openai: this.openai, anthropic: this.anthropic, mock: this.mock };
  }

  resolve(modelId: string): { strategy: LlmStrategy; model: string } {
    if (process.env.LOAD_TEST_MODE === 'true') {
      return { strategy: this.strategies['mock'], model: 'mock-model' };
    }

    const entry = LLM_MODEL_REGISTRY[modelId];
    if (!entry) {
      throw new RpcException(ORCHESTRATION_ERROR.UNKNOWN_LLM_MODEL);
    }
    return { strategy: this.strategies[entry.strategyId], model: entry.model };
  }
}
