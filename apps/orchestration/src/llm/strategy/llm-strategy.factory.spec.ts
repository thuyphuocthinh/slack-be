import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';
import { ORCHESTRATION_ERROR } from '@slack/constants';
import { LlmStrategyFactory } from './llm-strategy.factory';
import { GeminiStrategy } from './gemini.strategy';
import { OpenAiStrategy } from './openai.strategy';
import { AnthropicStrategy } from './anthropic.strategy';

describe('LlmStrategyFactory', () => {
  let factory: LlmStrategyFactory;

  const mockGemini = { id: 'gemini' };
  const mockOpenAi = { id: 'openai' };
  const mockAnthropic = { id: 'anthropic' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmStrategyFactory,
        { provide: GeminiStrategy, useValue: mockGemini },
        { provide: OpenAiStrategy, useValue: mockOpenAi },
        { provide: AnthropicStrategy, useValue: mockAnthropic },
      ],
    }).compile();

    factory = module.get<LlmStrategyFactory>(LlmStrategyFactory);
  });

  afterEach(() => jest.clearAllMocks());

  it('resolves a Gemini model id to the Gemini strategy + real SDK model name', () => {
    const result = factory.resolve('gemini-2.0-flash');
    expect(result.strategy).toBe(mockGemini);
    expect(result.model).toBe('gemini-2.0-flash');
  });

  it('resolves an OpenAI model id to the OpenAI strategy', () => {
    const result = factory.resolve('gpt-4o-mini');
    expect(result.strategy).toBe(mockOpenAi);
    expect(result.model).toBe('gpt-4o-mini');
  });

  it('resolves an Anthropic model id to the Anthropic strategy', () => {
    const result = factory.resolve('claude-haiku');
    expect(result.strategy).toBe(mockAnthropic);
  });

  it('throws RpcException with UNKNOWN_LLM_MODEL for an unregistered model id', () => {
    expect(() => factory.resolve('not-a-real-model')).toThrow(RpcException);
    try {
      factory.resolve('not-a-real-model');
      fail('expected resolve() to throw');
    } catch (error) {
      expect((error as RpcException).getError()).toEqual(ORCHESTRATION_ERROR.UNKNOWN_LLM_MODEL);
    }
  });
});
