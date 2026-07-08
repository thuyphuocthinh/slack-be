import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';

const mockCreate = jest.fn();
const mockStream = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return jest
    .fn()
    .mockImplementation(() => ({ messages: { create: mockCreate, stream: mockStream } }));
});

const mockGetCurrentRunTree = jest.fn();
jest.mock('langsmith/traceable', () => ({
  ...jest.requireActual('langsmith/traceable'),
  getCurrentRunTree: (...args: unknown[]) => mockGetCurrentRunTree(...args),
}));

import { AnthropicStrategy } from './anthropic.strategy';

describe('AnthropicStrategy', () => {
  let strategy: AnthropicStrategy;

  const createStrategy = async (): Promise<AnthropicStrategy> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AnthropicStrategy],
    }).compile();
    return module.get<AnthropicStrategy>(AnthropicStrategy);
  };

  beforeEach(async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    strategy = await createStrategy();
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('throws LLM_PROVIDER_NOT_CONFIGURED when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const unconfigured = await createStrategy();

    expect(() =>
      unconfigured.startChat({
        model: 'claude-haiku',
        systemInstruction: '',
        tools: [],
        history: [],
      }),
    ).toThrow(RpcException);
  });

  describe('startChat / sendMessage', () => {
    it('extracts text + tool_use blocks into the generic LlmTurnResult shape', async () => {
      mockStream.mockReturnValue({
        on: jest.fn().mockReturnThis(),
        finalMessage: async () => ({
          content: [
            { type: 'text', text: 'Để trả lời, mình cần xem schema.' },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'get_schema',
              input: { table: 'Orders' },
            },
          ],
        }),
      });

      const session = strategy.startChat({
        model: 'claude-haiku',
        systemInstruction: 'system prompt',
        tools: [
          {
            name: 'get_schema',
            description: 'desc',
            parameters: { type: 'object', properties: {} },
          },
        ],
        history: [{ role: 'model', text: 'chào' }],
      });
      const result = await session.sendMessage('hỏi gì đó');

      expect(result).toEqual({
        text: 'Để trả lời, mình cần xem schema.',
        toolCalls: [
          { id: 'toolu_1', name: 'get_schema', args: { table: 'Orders' } },
        ],
      });
      // system truyền qua tham số "system" riêng, KHÔNG nằm trong mảng messages (khác OpenAI)
      const firstCallArgs = mockStream.mock.calls[0][0];
      expect(firstCallArgs.system[0].text).toBe('system prompt');
      expect(firstCallArgs.messages.slice(0, 2)).toEqual([
        { role: 'assistant', content: 'chào' },
        { role: 'user', content: 'hỏi gì đó' },
      ]);
    });

    it('passes opts.temperature through to every messages.stream call (Step 7)', async () => {
      mockStream.mockReturnValue({
        on: jest.fn().mockReturnThis(),
        finalMessage: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      });

      const session = strategy.startChat({
        model: 'claude-haiku',
        systemInstruction: '',
        tools: [],
        history: [],
        temperature: 0.2,
      });
      await session.sendMessage('hi');

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.2 }),
      );
    });

    it('sends tool results back as a user turn with tool_result blocks, correlated by tool_use_id', async () => {
      mockStream
        .mockReturnValueOnce({
          on: jest.fn().mockReturnThis(),
          finalMessage: async () => ({
            content: [
              { type: 'tool_use', id: 'toolu_1', name: 'get_schema', input: {} },
            ],
          }),
        })
        .mockReturnValueOnce({
          on: jest.fn().mockReturnThis(),
          finalMessage: async () => ({
            content: [{ type: 'text', text: 'đã xong' }],
          }),
        });

      const session = strategy.startChat({
        model: 'claude-haiku',
        systemInstruction: 'sys',
        tools: [],
        history: [],
      });
      await session.sendMessage('hỏi gì đó');
      const second = await session.sendMessage([
        { id: 'toolu_1', name: 'get_schema', content: '{"Orders":[]}' },
      ]);

      expect(second.text).toBe('đã xong');
      const secondCallMessages = mockStream.mock.calls[1][0].messages;
      expect(secondCallMessages.slice(0, 3)).toEqual([
        { role: 'user', content: 'hỏi gì đó' },
        expect.objectContaining({ role: 'assistant' }),
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: '{"Orders":[]}',
            },
          ],
        },
      ]);
    });

    it('Giai đoạn 4, Step 7 — attaches token usage from message.usage onto the current trace', async () => {
      const runTree: { metadata?: unknown } = {};
      mockGetCurrentRunTree.mockReturnValueOnce(runTree);
      mockStream.mockReturnValue({
        on: jest.fn().mockReturnThis(),
        finalMessage: async () => ({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 40, output_tokens: 9 },
        }),
      });

      const session = strategy.startChat({
        model: 'claude-haiku',
        systemInstruction: '',
        tools: [],
        history: [],
      });
      await session.sendMessage('hi');

      expect(runTree.metadata).toEqual(
        expect.objectContaining({
          usage_metadata: expect.objectContaining({
            input_tokens: 40,
            output_tokens: 9,
          }),
        }),
      );
    });
  });

  describe('generateStructured', () => {
    it('forces the "decision" tool via tool_choice and reads its input as the result', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'decision',
            input: { action: 'respond', answer: 'chào' },
          },
        ],
      });

      const result = await strategy.generateStructured({
        model: 'claude-haiku',
        systemInstruction: 'system',
        prompt: 'chào bạn',
        schema: { type: 'object', properties: { action: { type: 'string' } } },
      });

      expect(result).toEqual({ action: 'respond', answer: 'chào' });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_choice: { type: 'tool', name: 'decision' },
        }),
      );
    });

    it('returns an empty object if the model somehow does not call the forced tool', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'oops' }],
      });

      const result = await strategy.generateStructured({
        model: 'claude-haiku',
        systemInstruction: '',
        prompt: '',
        schema: { type: 'object', properties: {} },
      });

      expect(result).toEqual({});
    });

    it('Giai đoạn 4, Step 7 — attaches token usage from message.usage onto the current trace', async () => {
      const runTree: { metadata?: unknown } = {};
      mockGetCurrentRunTree.mockReturnValueOnce(runTree);
      mockCreate.mockResolvedValue({
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'decision', input: {} },
        ],
        usage: { input_tokens: 25, output_tokens: 6 },
      });

      await strategy.generateStructured({
        model: 'claude-haiku',
        systemInstruction: '',
        prompt: '',
        schema: {},
      });

      expect(runTree.metadata).toEqual(
        expect.objectContaining({
          usage_metadata: expect.objectContaining({
            input_tokens: 25,
            output_tokens: 6,
          }),
        }),
      );
    });
  });
});
