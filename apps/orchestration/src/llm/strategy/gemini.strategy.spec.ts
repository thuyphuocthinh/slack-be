import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';

const mockGetCurrentRunTree = jest.fn();
jest.mock('langsmith/traceable', () => ({
  ...jest.requireActual('langsmith/traceable'),
  getCurrentRunTree: (...args: unknown[]) => mockGetCurrentRunTree(...args),
}));

import { GeminiStrategy } from './gemini.strategy';

const mockChatSendMessage = jest.fn();
const mockStartChat = jest
  .fn()
  .mockReturnValue({ sendMessage: mockChatSendMessage });
const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn().mockReturnValue({
  startChat: mockStartChat,
  generateContent: mockGenerateContent,
});

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest
    .fn()
    .mockImplementation(() => ({ getGenerativeModel: mockGetGenerativeModel })),
}));

describe('GeminiStrategy', () => {
  let strategy: GeminiStrategy;

  const createStrategy = async (): Promise<GeminiStrategy> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GeminiStrategy],
    }).compile();
    return module.get<GeminiStrategy>(GeminiStrategy);
  };

  beforeEach(async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    strategy = await createStrategy();
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  describe('when GEMINI_API_KEY is missing', () => {
    it('throws LLM_PROVIDER_NOT_CONFIGURED instead of calling the SDK', async () => {
      delete process.env.GEMINI_API_KEY;
      const unconfigured = await createStrategy();

      expect(() =>
        unconfigured.startChat({
          model: 'gemini-2.0-flash',
          systemInstruction: '',
          tools: [],
          history: [],
        }),
      ).toThrow(RpcException);
      await expect(
        unconfigured.generateStructured({
          model: 'gemini-2.0-flash',
          systemInstruction: '',
          prompt: '',
          schema: {},
        }),
      ).rejects.toThrow(RpcException);
    });
  });

  describe('startChat / sendMessage', () => {
    it('converts the model response into the generic LlmTurnResult shape', async () => {
      mockChatSendMessage.mockResolvedValue({
        response: {
          text: () => 'Đây là câu trả lời',
          functionCalls: () => [
            { name: 'get_schema', args: { table: 'Orders' } },
          ],
        },
      });

      const session = strategy.startChat({
        model: 'gemini-2.0-flash',
        systemInstruction: 'system prompt',
        tools: [
          {
            name: 'get_schema',
            description: 'desc',
            parameters: { type: 'object', properties: {} },
          },
        ],
        history: [],
      });
      const result = await session.sendMessage('hỏi gì đó');

      expect(result).toEqual({
        text: 'Đây là câu trả lời',
        toolCalls: [{ name: 'get_schema', args: { table: 'Orders' } }],
      });
      expect(mockChatSendMessage).toHaveBeenCalledWith('hỏi gì đó');
    });

    it('passes opts.temperature through to generationConfig when provided (Step 7)', async () => {
      mockChatSendMessage.mockResolvedValue({
        response: { text: () => 'ok', functionCalls: () => [] },
      });

      strategy.startChat({
        model: 'gemini-2.0-flash',
        systemInstruction: '',
        tools: [],
        history: [],
        temperature: 0.2,
      });

      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({ generationConfig: { temperature: 0.2 } }),
      );
    });

    it('serializes tool results into Gemini functionResponse parts', async () => {
      mockChatSendMessage.mockResolvedValue({
        response: { text: () => 'ok', functionCalls: () => [] },
      });

      const session = strategy.startChat({
        model: 'gemini-2.0-flash',
        systemInstruction: '',
        tools: [],
        history: [],
      });
      await session.sendMessage([
        { name: 'get_schema', content: '{"Orders":[]}' },
      ]);

      expect(mockChatSendMessage).toHaveBeenCalledWith([
        {
          functionResponse: {
            name: 'get_schema',
            response: { content: '{"Orders":[]}' },
          },
        },
      ]);
    });

    it('retries once on a transient 429 error, then succeeds', async () => {
      jest.useFakeTimers();
      mockChatSendMessage
        .mockRejectedValueOnce(
          new Error('[429 Too Many Requests] quota exceeded'),
        )
        .mockResolvedValueOnce({
          response: { text: () => 'ok sau khi retry', functionCalls: () => [] },
        });

      const session = strategy.startChat({
        model: 'gemini-2.0-flash',
        systemInstruction: '',
        tools: [],
        history: [],
      });
      const promise = session.sendMessage('hi');
      await jest.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result.text).toBe('ok sau khi retry');
      expect(mockChatSendMessage).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    it('does not retry a non-transient error', async () => {
      mockChatSendMessage.mockRejectedValue(new Error('invalid request'));

      const session = strategy.startChat({
        model: 'gemini-2.0-flash',
        systemInstruction: '',
        tools: [],
        history: [],
      });

      await expect(session.sendMessage('hi')).rejects.toThrow(
        'invalid request',
      );
      expect(mockChatSendMessage).toHaveBeenCalledTimes(1);
    });

    it('Giai đoạn 4, Step 7 — attaches token usage from usageMetadata onto the current trace', async () => {
      const runTree: { metadata?: unknown } = {};
      mockGetCurrentRunTree.mockReturnValueOnce(runTree);
      mockChatSendMessage.mockResolvedValue({
        response: {
          text: () => 'ok',
          functionCalls: () => [],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 34 },
        },
      });

      const session = strategy.startChat({
        model: 'gemini-2.0-flash',
        systemInstruction: '',
        tools: [],
        history: [],
      });
      await session.sendMessage('hi');

      expect(runTree.metadata).toEqual(
        expect.objectContaining({
          usage_metadata: expect.objectContaining({
            input_tokens: 12,
            output_tokens: 34,
          }),
        }),
      );
    });
  });

  describe('generateStructured', () => {
    it('parses the JSON text response into the expected object', async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => '{"action":"respond","answer":"chào"}' },
      });

      const result = await strategy.generateStructured({
        model: 'gemini-2.0-flash',
        systemInstruction: 'system',
        prompt: 'chào bạn',
        schema: { type: 'object', properties: { action: { type: 'string' } } },
      });

      expect(result).toEqual({ action: 'respond', answer: 'chào' });
    });

    it('auto-injects format:"enum" for string enum fields (Gemini-specific requirement)', async () => {
      mockGenerateContent.mockResolvedValue({ response: { text: () => '{}' } });

      await strategy.generateStructured({
        model: 'gemini-2.0-flash',
        systemInstruction: '',
        prompt: '',
        schema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['respond', 'delegate'] },
          },
        },
      });

      const passedSchema =
        mockGetGenerativeModel.mock.calls.at(-1)?.[0].generationConfig
          .responseSchema;
      expect(passedSchema.properties.action).toEqual({
        type: 'string',
        enum: ['respond', 'delegate'],
        format: 'enum',
      });
    });

    it('retries on a transient 429/503 error just like startChat (Supervisor hits this path on every message)', async () => {
      jest.useFakeTimers();
      mockGenerateContent
        .mockRejectedValueOnce(
          new Error('[503 Service Unavailable] model overloaded'),
        )
        .mockResolvedValueOnce({
          response: {
            text: () => '{"action":"respond","answer":"ok sau retry"}',
          },
        });

      const promise = strategy.generateStructured({
        model: 'gemini-2.0-flash',
        systemInstruction: '',
        prompt: 'chào bạn',
        schema: { type: 'object', properties: {} },
      });
      await jest.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result).toEqual({ action: 'respond', answer: 'ok sau retry' });
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    it('Giai đoạn 4, Step 7 — attaches token usage from usageMetadata onto the current trace', async () => {
      const runTree: { metadata?: unknown } = {};
      mockGetCurrentRunTree.mockReturnValueOnce(runTree);
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => '{}',
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 },
        },
      });

      await strategy.generateStructured({
        model: 'gemini-2.0-flash',
        systemInstruction: '',
        prompt: '',
        schema: {},
      });

      expect(runTree.metadata).toEqual(
        expect.objectContaining({
          usage_metadata: expect.objectContaining({
            input_tokens: 5,
            output_tokens: 7,
          }),
        }),
      );
    });
  });
});
