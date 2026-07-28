import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';

const mockCreate = jest.fn();

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
});

const mockGetCurrentRunTree = jest.fn();
jest.mock('langsmith/traceable', () => ({
  ...jest.requireActual('langsmith/traceable'),
  getCurrentRunTree: (...args: unknown[]) => mockGetCurrentRunTree(...args),
}));

import { OpenAiStrategy } from './openai.strategy';

// rawSend() always calls chat.completions.create() with stream: true and iterates the result as
// an async-iterable of chunks shaped { choices: [{ delta }] } — this fakes that shape from a plain
// array of chunks, matching what the real OpenAI SDK stream yields.
function mockStream(chunks: any[]): AsyncIterable<any> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () =>
          i < chunks.length
            ? { value: chunks[i++], done: false }
            : { value: undefined, done: true },
      };
    },
  };
}

describe('OpenAiStrategy', () => {
  let strategy: OpenAiStrategy;

  const createStrategy = async (): Promise<OpenAiStrategy> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OpenAiStrategy],
    }).compile();
    return module.get<OpenAiStrategy>(OpenAiStrategy);
  };

  beforeEach(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    strategy = await createStrategy();
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it('throws LLM_PROVIDER_NOT_CONFIGURED when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const unconfigured = await createStrategy();

    expect(() =>
      unconfigured.startChat({
        model: 'gpt-4o-mini',
        systemInstruction: '',
        tools: [],
        history: [],
      }),
    ).toThrow(RpcException);
  });

  describe('startChat / sendMessage', () => {
    it('sends system + history on the first turn and maps tool_calls into LlmTurnResult', async () => {
      mockCreate.mockResolvedValue(
        mockStream([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: {
                        name: 'get_schema',
                        arguments: '{"table":"Orders"}',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ]),
      );

      const session = strategy.startChat({
        model: 'gpt-4o-mini',
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

      expect(result.toolCalls).toEqual([
        { id: 'call_1', name: 'get_schema', args: { table: 'Orders' } },
      ]);
      // messages là mảng mutable bị push tiếp SAU khi create() resolve (thêm
      // turn assistant) — slice đúng 3 phần tử ĐẦU (không đổi bởi push sau
      // này) thay vì so sánh nguyên mảng tại thời điểm assert.
      const firstCallArgs = mockCreate.mock.calls[0][0];
      expect(firstCallArgs.messages.slice(0, 3)).toEqual([
        { role: 'system', content: 'system prompt' },
        { role: 'assistant', content: 'chào' },
        { role: 'user', content: 'hỏi gì đó' },
      ]);
    });

    it('passes opts.temperature through to every chat.completions.create call (Step 7)', async () => {
      mockCreate.mockResolvedValue(
        mockStream([{ choices: [{ delta: { content: 'ok' } }] }]),
      );

      const session = strategy.startChat({
        model: 'gpt-4o-mini',
        systemInstruction: '',
        tools: [],
        history: [],
        temperature: 0.2,
      });
      await session.sendMessage('hi');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.2 }),
        expect.anything(),
      );
    });

    it('carries assistant + tool-result turns forward across sequential sendMessage calls (stateful session)', async () => {
      mockCreate
        .mockResolvedValueOnce(
          mockStream([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'get_schema', arguments: '{}' },
                      },
                    ],
                  },
                },
              ],
            },
          ]),
        )
        .mockResolvedValueOnce(
          mockStream([{ choices: [{ delta: { content: 'đã xong' } }] }]),
        );

      const session = strategy.startChat({
        model: 'gpt-4o-mini',
        systemInstruction: 'sys',
        tools: [],
        history: [],
      });
      await session.sendMessage('hỏi gì đó');
      const second = await session.sendMessage([
        { id: 'call_1', name: 'get_schema', content: '{"Orders":[]}' },
      ]);

      expect(second.text).toBe('đã xong');
      const secondCallMessages = mockCreate.mock.calls[1][0].messages;
      expect(secondCallMessages.slice(0, 4)).toEqual([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hỏi gì đó' },
        expect.objectContaining({
          role: 'assistant',
          tool_calls: expect.any(Array),
        }),
        { role: 'tool', tool_call_id: 'call_1', content: '{"Orders":[]}' },
      ]);
    });

    it('falls back to an empty args object when the model returns malformed JSON arguments', async () => {
      mockCreate.mockResolvedValue(
        mockStream([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'x', arguments: ']' },
                    },
                  ],
                },
              },
            ],
          },
        ]),
      );

      const session = strategy.startChat({
        model: 'gpt-4o-mini',
        systemInstruction: '',
        tools: [],
        history: [],
      });
      const result = await session.sendMessage('hi');

      expect(result.toolCalls[0].args).toEqual({});
    });

    it('Giai đoạn 4, Step 7 — attaches token usage from completion.usage onto the current trace', async () => {
      const runTree: { metadata?: unknown } = {};
      mockGetCurrentRunTree.mockReturnValue(runTree);
      mockCreate.mockResolvedValue(
        mockStream([
          { choices: [{ delta: { content: 'ok' } }] },
          {
            choices: [],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 8,
              total_tokens: 28,
            },
          },
        ]),
      );

      const session = strategy.startChat({
        model: 'gpt-4o-mini',
        systemInstruction: '',
        tools: [],
        history: [],
      });
      await session.sendMessage('hi');

      expect(runTree.metadata).toEqual(
        expect.objectContaining({
          usage_metadata: expect.objectContaining({
            input_tokens: 20,
            output_tokens: 8,
          }),
        }),
      );
    });
  });

  describe('generateStructured', () => {
    it('requests json_schema response_format and parses the resulting content', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          { message: { content: '{"action":"respond","answer":"chào"}' } },
        ],
      });

      const result = await strategy.generateStructured({
        model: 'gpt-4o-mini',
        systemInstruction: 'system',
        prompt: 'chào bạn',
        schema: { type: 'object', properties: { action: { type: 'string' } } },
      });

      expect(result).toEqual({ action: 'respond', answer: 'chào' });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: {
            type: 'json_schema',
            json_schema: expect.objectContaining({ name: 'decision' }),
          },
        }),
        expect.anything(),
      );
    });

    it('Giai đoạn 4, Step 7 — attaches token usage from completion.usage onto the current trace', async () => {
      const runTree: { metadata?: unknown } = {};
      mockGetCurrentRunTree.mockReturnValue(runTree);
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '{}' } }],
        usage: { prompt_tokens: 15, completion_tokens: 3, total_tokens: 18 },
      });

      await strategy.generateStructured({
        model: 'gpt-4o-mini',
        systemInstruction: '',
        prompt: '',
        schema: {},
      });

      expect(runTree.metadata).toEqual(
        expect.objectContaining({
          usage_metadata: expect.objectContaining({
            input_tokens: 15,
            output_tokens: 3,
          }),
        }),
      );
    });

    it('recovers when 9Router returns the completion as a raw string with a trailing SSE "data: [DONE]" marker', async () => {
      // Bug thật gặp ở production: 9Router gắn nhầm content-type SSE cho 1 request
      // non-stream, JSON body hợp lệ bị dính thêm "data: [DONE]" ở cuối. Chuỗi
      // "[DONE]" tự chứa dấu ngoặc nên JsonExtractor từng bị đánh lừa nếu không
      // dọn rác này trước.
      const rawBody =
        '{"choices":[{"message":{"content":"{\\"action\\":\\"respond\\",\\"answer\\":\\"chào\\"}"}}]}\ndata: [DONE]\n\n';
      mockCreate.mockResolvedValue(rawBody);

      const result = await strategy.generateStructured({
        model: 'gpt-4o-mini',
        systemInstruction: '',
        prompt: '',
        schema: {},
      });

      expect(result).toEqual({ action: 'respond', answer: 'chào' });
    });
  });
});
