import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { NAME_SERVICE_TCP } from '@slack/constants';
import { MessageClientService } from './message-client.service';
import { ChannelMemoryService } from './memory/channel-memory.service';
import { LlmStrategyFactory } from './llm/strategy/llm-strategy.factory';
import { CircuitBreakerService } from './common/circuit-breaker.service';

describe('MessageClientService', () => {
  let service: MessageClientService;
  const mockMessageService = { send: jest.fn() };
  const mockChannelMemory = {
    recordSuccessfulCreateCalls: jest.fn().mockResolvedValue(undefined),
    getRecentMemories: jest.fn().mockResolvedValue([]),
  };
  // Không cấu hình resolve() -> destructure {strategy, model} từ undefined
  // ném lỗi ngay -> summarizeSnippets() rơi về fallback rule-based, đúng
  // hành vi CŨ (giữ nguyên các test đã có từ trước không cần sửa gì).
  const mockLlmFactory = { resolve: jest.fn() };
  const mockCircuitBreaker = { run: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageClientService,
        {
          provide: NAME_SERVICE_TCP.MESSAGE_SERVICE,
          useValue: mockMessageService,
        },
        { provide: ChannelMemoryService, useValue: mockChannelMemory },
        { provide: LlmStrategyFactory, useValue: mockLlmFactory },
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
      ],
    }).compile();

    service = module.get<MessageClientService>(MessageClientService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getMessageText — content extraction (Step 7 bug: prompt was empty for real user messages)', () => {
    it('extracts text from a parsed TipTap doc object (real user message — message.service.ts already JSON.parse()s it before returning)', async () => {
      mockMessageService.send.mockReturnValue(
        of({
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'liệt kê danh sách đơn hàng' }],
              },
            ],
          },
        }),
      );

      const text = await service.getMessageText({
        id: 'msg-1',
        userId: 'user-1',
      });

      expect(text).toBe('liệt kê danh sách đơn hàng');
    });

    it('joins multiple text nodes across nested paragraphs/marks with a space', async () => {
      mockMessageService.send.mockReturnValue(
        of({
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Hello' },
                  { type: 'text', text: 'world' },
                ],
              },
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'second line' }],
              },
            ],
          },
        }),
      );

      const text = await service.getMessageText({
        id: 'msg-1',
        userId: 'user-1',
      });

      expect(text).toBe('Hello world second line');
    });

    it('returns a plain string as-is when it is genuinely plain text, not JSON (bot-authored messages)', async () => {
      mockMessageService.send.mockReturnValue(
        of({ content: 'Xin chào! Mình có thể giúp gì cho bạn hôm nay?' }),
      );

      const text = await service.getMessageText({
        id: 'msg-1',
        userId: 'user-1',
      });

      expect(text).toBe('Xin chào! Mình có thể giúp gì cho bạn hôm nay?');
    });

    it('parses a JSON-string-encoded TipTap doc too, in case content ever arrives un-parsed', async () => {
      mockMessageService.send.mockReturnValue(
        of({
          content: JSON.stringify({
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'raw json string' }],
              },
            ],
          }),
        }),
      );

      const text = await service.getMessageText({
        id: 'msg-1',
        userId: 'user-1',
      });

      expect(text).toBe('raw json string');
    });

    it('returns empty string for content with no text nodes (VD chỉ có mention/image)', async () => {
      mockMessageService.send.mockReturnValue(
        of({
          content: {
            type: 'doc',
            content: [
              { type: 'mention', attrs: { id: 'u1', label: 'someone' } },
            ],
          },
        }),
      );

      const text = await service.getMessageText({
        id: 'msg-1',
        userId: 'user-1',
      });

      expect(text).toBe('');
    });
  });

  describe('getRecentHistory', () => {
    it('extracts text per message and filters out turns with no extractable text', async () => {
      mockMessageService.send.mockReturnValue(
        of({
          messages: [
            { content: 'AI reply mới nhất', sender: { isBot: true } },
            {
              content: {
                type: 'doc',
                content: [{ type: 'mention', attrs: {} }],
              },
              sender: { isBot: false },
            }, // rỗng, bị lọc
            {
              content: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'câu hỏi trước đó' }],
                  },
                ],
              },
              sender: { isBot: false },
            },
          ],
        }),
      );

      const history = await service.getRecentHistory({
        channelId: 'c1',
        userId: 'u1',
        beforeMessageId: 'm1',
        limit: 10,
      });

      // đảo DESC -> ASC (cũ -> mới) rồi lọc rỗng. Turn "model" bị ẩn nội
      // dung (mục 17) — xem test riêng bên dưới cho lý do.
      expect(history).toEqual([
        { role: 'user', text: 'câu hỏi trước đó' },
        {
          role: 'model',
          text: expect.stringContaining('nội dung câu trả lời cũ đã ẩn'),
        },
      ]);
    });

    // accuracy_problem.md mục 17 — trước đây chỉ SupervisorService.buildPrompt()
    // tự ẩn câu trả lời cũ của AI (copy riêng, cùng nội dung) — ReactLoopService
    // nhận CÙNG mảng history này y nguyên, đưa thẳng vào lịch sử chat NATIVE
    // của model mà không ẩn gì, khiến sub-agent thực thi 1 bước KHÔNG liên
    // quan vẫn thấy được câu trả lời THẬT của lượt trước, dễ bị lái sang xác
    // nhận lại chủ đề cũ. Ẩn NGAY TẠI ĐÂY để MỌI consumer của history đều
    // được bảo vệ, không chỉ SupervisorService.
    it('accuracy_problem.md mục 17 — redacts old AI (model role) message content so no consumer of history (ReactLoopService included) sees stale answer text', async () => {
      mockMessageService.send.mockReturnValue(
        of({
          messages: [
            {
              content: 'Không tìm thấy tên nào khớp.',
              sender: { isBot: true },
            },
            {
              content: 'bảng customers có ai tên như ri k',
              sender: { isBot: false },
            },
          ],
        }),
      );

      const history = await service.getRecentHistory({
        channelId: 'c1',
        userId: 'u1',
        beforeMessageId: 'm1',
        limit: 10,
      });

      const modelTurn = history.find((h) => h.role === 'model');
      expect(modelTurn?.text).not.toContain('Không tìm thấy tên nào khớp');
      expect(modelTurn?.text).toContain('nội dung câu trả lời cũ đã ẩn');
      const userTurn = history.find((h) => h.role === 'user');
      expect(userTurn?.text).toBe('bảng customers có ai tên như ri k');
    });

    describe('ver3.md mục 1 (ngắn hạn) — recap toolCalls của các lượt bot gần nhất', () => {
      it('appends a tool-call recap after the redaction marker for the most recent bot turn that has toolCalls', async () => {
        mockMessageService.send.mockReturnValue(
          of({
            messages: [
              {
                content: 'câu hỏi mới',
                sender: { isBot: false },
              },
              {
                content: 'Đã tạo xong.',
                sender: { isBot: true },
                toolCalls: [
                  {
                    tool: 'notion.create_page',
                    status: 'success',
                    argsPreview: "title='Roadmap'",
                    resultPreview: 'Page id=abc123',
                  },
                ],
              },
            ],
          }),
        );

        const history = await service.getRecentHistory({
          channelId: 'c1',
          userId: 'u1',
          beforeMessageId: 'm1',
          limit: 10,
        });

        const modelTurn = history.find((h) => h.role === 'model');
        expect(modelTurn?.text).toContain('nội dung câu trả lời cũ đã ẩn');
        expect(modelTurn?.text).toContain('Lượt trước đã thử:');
        expect(modelTurn?.text).toContain(
          "notion.create_page (title='Roadmap') → THÀNH CÔNG: Page id=abc123",
        );
      });

      it('does not add a recap when the bot turn has no toolCalls (existing behavior unchanged)', async () => {
        mockMessageService.send.mockReturnValue(
          of({
            messages: [
              { content: 'câu trả lời thường', sender: { isBot: true } },
              { content: 'câu hỏi', sender: { isBot: false } },
            ],
          }),
        );

        const history = await service.getRecentHistory({
          channelId: 'c1',
          userId: 'u1',
          beforeMessageId: 'm1',
          limit: 10,
        });

        const modelTurn = history.find((h) => h.role === 'model');
        expect(modelTurn?.text).toBe(
          '(nội dung câu trả lời cũ đã ẩn khỏi ngữ cảnh này — KHÔNG được dùng làm dữ liệu; nếu câu hỏi hiện tại cần dữ liệu/số liệu cụ thể, PHẢI delegate lại để lấy MỚI)',
        );
      });

      it('only recaps the TOOL_CALL_RECAP_LOOKBACK_TURNS most recent bot turns with toolCalls', async () => {
        mockMessageService.send.mockReturnValue(
          of({
            messages: [
              // DESC (mới nhất trước): 3 lượt bot có toolCalls, chỉ 2 gần nhất được recap
              {
                content: 'gần nhất',
                sender: { isBot: true },
                toolCalls: [
                  {
                    tool: 'notion.create_page',
                    status: 'success',
                    resultPreview: 'r1',
                  },
                ],
              },
              {
                content: 'giữa',
                sender: { isBot: true },
                toolCalls: [
                  {
                    tool: 'notion.create_page',
                    status: 'success',
                    resultPreview: 'r2',
                  },
                ],
              },
              {
                content: 'cũ nhất',
                sender: { isBot: true },
                toolCalls: [
                  {
                    tool: 'notion.create_page',
                    status: 'success',
                    resultPreview: 'r3',
                  },
                ],
              },
            ],
          }),
        );

        const history = await service.getRecentHistory({
          channelId: 'c1',
          userId: 'u1',
          beforeMessageId: 'm1',
          limit: 10,
        });

        const modelTurns = history.filter((h) => h.role === 'model');
        expect(modelTurns).toHaveLength(3);
        expect(modelTurns[0].text).not.toContain('Lượt trước đã thử'); // cũ nhất — ngoài lookback
        expect(modelTurns[1].text).toContain('r2');
        expect(modelTurns[2].text).toContain('r1');
      });
    });

    describe('Giai đoạn 4, Step 5 — tóm tắt ngữ cảnh bị cắt khi thread dài hơn CHAT_HISTORY_LIMIT', () => {
      it('prepends a rule-based summary turn when message-service reports more history beyond the fetched window (nextCursor present)', async () => {
        mockMessageService.send
          .mockReturnValueOnce(
            of({
              messages: [
                { content: 'câu hỏi gần nhất', sender: { isBot: false } },
              ],
              nextCursor: 'oldest-in-window',
            }),
          )
          .mockReturnValueOnce(
            // API trả DESC (mới nhất trước) — reverse() trong service sẽ đảo lại thành cũ -> mới.
            of({
              messages: [
                {
                  content: 'Doanh thu tháng này là 100 triệu.',
                  sender: { isBot: true },
                },
                {
                  content: 'doanh thu tháng này bao nhiêu?',
                  sender: { isBot: false },
                },
              ],
            }),
          );

        const history = await service.getRecentHistory({
          channelId: 'c1',
          userId: 'u1',
          beforeMessageId: 'm1',
          limit: 10,
        });

        // Lô tóm tắt được lấy NGAY TRƯỚC cửa sổ chính, dùng đúng nextCursor làm cursor mới.
        expect(mockMessageService.send).toHaveBeenNthCalledWith(
          2,
          expect.anything(),
          expect.objectContaining({
            cursor: 'oldest-in-window',
            direction: 'before',
          }),
        );
        expect(history[0]).toEqual({
          role: 'user',
          text: '(Tóm tắt ngữ cảnh cũ hơn, KHÔNG phải câu hỏi mới) Trước đó, cuộc trò chuyện đã đề cập: doanh thu tháng này bao nhiêu?; Doanh thu tháng này là 100 triệu.',
        });
        expect(history[1]).toEqual({ role: 'user', text: 'câu hỏi gần nhất' });
      });

      it('does NOT fetch or prepend anything when there is no more history beyond the window (nextCursor absent)', async () => {
        mockMessageService.send.mockReturnValueOnce(
          of({
            messages: [
              { content: 'câu hỏi gần nhất', sender: { isBot: false } },
            ],
          }),
        );

        const history = await service.getRecentHistory({
          channelId: 'c1',
          userId: 'u1',
          beforeMessageId: 'm1',
          limit: 10,
        });

        expect(mockMessageService.send).toHaveBeenCalledTimes(1);
        expect(history).toEqual([{ role: 'user', text: 'câu hỏi gần nhất' }]);
      });

      it('falls back to no summary turn (not a thrown error) when the extra lookback fetch has no usable text', async () => {
        mockMessageService.send
          .mockReturnValueOnce(
            of({
              messages: [{ content: 'gần nhất', sender: { isBot: false } }],
              nextCursor: 'x',
            }),
          )
          .mockReturnValueOnce(of({ messages: [] }));

        const history = await service.getRecentHistory({
          channelId: 'c1',
          userId: 'u1',
          beforeMessageId: 'm1',
          limit: 10,
        });

        expect(history).toEqual([{ role: 'user', text: 'gần nhất' }]);
      });

      it('does not block getRecentHistory() when the extra lookback fetch itself fails', async () => {
        mockMessageService.send.mockReturnValueOnce(
          of({
            messages: [{ content: 'gần nhất', sender: { isBot: false } }],
            nextCursor: 'x',
          }),
        );
        mockMessageService.send.mockImplementationOnce(() => {
          throw new Error('message service unreachable');
        });

        const history = await service.getRecentHistory({
          channelId: 'c1',
          userId: 'u1',
          beforeMessageId: 'm1',
          limit: 10,
        });

        expect(history).toEqual([{ role: 'user', text: 'gần nhất' }]);
      });

      it('truncates an overly long summary to TRUNCATED_HISTORY_SUMMARY_MAX_CHARS with a trailing ellipsis', async () => {
        const longText = 'a'.repeat(400);
        mockMessageService.send
          .mockReturnValueOnce(
            of({
              messages: [{ content: 'gần nhất', sender: { isBot: false } }],
              nextCursor: 'x',
            }),
          )
          .mockReturnValueOnce(
            of({ messages: [{ content: longText, sender: { isBot: false } }] }),
          );

        const history = await service.getRecentHistory({
          channelId: 'c1',
          userId: 'u1',
          beforeMessageId: 'm1',
          limit: 10,
        });

        expect(history[0].text.endsWith('...')).toBe(true);
        expect(history[0].text.length).toBeLessThan(longText.length);
      });

      it('uses the LLM-generated summary when the strategy resolves and succeeds', async () => {
        mockMessageService.send
          .mockReturnValueOnce(
            of({
              messages: [
                { content: 'câu hỏi gần nhất', sender: { isBot: false } },
              ],
              nextCursor: 'x',
            }),
          )
          .mockReturnValueOnce(
            of({
              messages: [
                {
                  content: 'doanh thu tháng này bao nhiêu?',
                  sender: { isBot: false },
                },
              ],
            }),
          );
        const mockGenerateStructured = jest
          .fn()
          .mockResolvedValueOnce({ summary: 'Đã hỏi về doanh thu tháng này.' });
        mockLlmFactory.resolve.mockReturnValueOnce({
          strategy: {
            id: 'openai',
            generateStructured: mockGenerateStructured,
          },
          model: 'gpt-4.1-nano',
        });
        mockCircuitBreaker.run.mockImplementationOnce((_key, action) =>
          action(),
        );

        const history = await service.getRecentHistory({
          channelId: 'c1',
          userId: 'u1',
          beforeMessageId: 'm1',
          limit: 10,
        });

        expect(history[0].text).toContain('Đã hỏi về doanh thu tháng này.');
      });

      it('falls back to the rule-based join when the LLM call fails', async () => {
        mockMessageService.send
          .mockReturnValueOnce(
            of({
              messages: [
                { content: 'câu hỏi gần nhất', sender: { isBot: false } },
              ],
              nextCursor: 'x',
            }),
          )
          .mockReturnValueOnce(
            of({
              messages: [{ content: 'ngữ cảnh cũ', sender: { isBot: false } }],
            }),
          );
        mockLlmFactory.resolve.mockReturnValueOnce({
          strategy: { id: 'openai' },
          model: 'gpt-4.1-nano',
        });
        mockCircuitBreaker.run.mockRejectedValueOnce(
          new Error('provider down'),
        );

        const history = await service.getRecentHistory({
          channelId: 'c1',
          userId: 'u1',
          beforeMessageId: 'm1',
          limit: 10,
        });

        expect(history[0].text).toContain('ngữ cảnh cũ');
      });
    });
  });

  describe('updateMessage — ver3.md mục 1 (dài hạn) channel_memory write-path hook', () => {
    it('calls ChannelMemoryService.recordSuccessfulCreateCalls when channelId and toolCalls are both present', async () => {
      mockMessageService.send.mockReturnValue(of(undefined));

      await service.updateMessage({
        id: 'msg-1',
        userId: 'bot-1',
        channelId: 'chan-1',
        content: 'Đã tạo xong.',
        toolCalls: [
          {
            tool: 'notion.create_page',
            status: 'success',
            resultPreview: 'r1',
          },
        ],
      });

      expect(
        mockChannelMemory.recordSuccessfulCreateCalls,
      ).toHaveBeenCalledWith('chan-1', 'msg-1', [
        { tool: 'notion.create_page', status: 'success', resultPreview: 'r1' },
      ]);
    });

    it('does NOT call ChannelMemoryService when channelId is missing (error-branch text-only updates)', async () => {
      mockMessageService.send.mockReturnValue(of(undefined));

      await service.updateMessage({
        id: 'msg-1',
        userId: 'bot-1',
        content: '⚠️ Lỗi xảy ra.',
      });

      expect(
        mockChannelMemory.recordSuccessfulCreateCalls,
      ).not.toHaveBeenCalled();
    });

    it('does NOT call ChannelMemoryService when toolCalls is empty/absent even with channelId set', async () => {
      mockMessageService.send.mockReturnValue(of(undefined));

      await service.updateMessage({
        id: 'msg-1',
        userId: 'bot-1',
        channelId: 'chan-1',
        content: 'ok',
      });

      expect(
        mockChannelMemory.recordSuccessfulCreateCalls,
      ).not.toHaveBeenCalled();
    });
  });

  describe('tryUpdateMessage — hardening: turn/checkpoint claims never rollback, so a failing error-report update must never escape', () => {
    it('resolves normally (does not throw) when updateMessage succeeds', async () => {
      mockMessageService.send.mockReturnValue(of(undefined));

      await expect(
        service.tryUpdateMessage({
          id: 'msg-1',
          userId: 'bot-1',
          content: 'ok',
        }),
      ).resolves.toBeUndefined();
    });

    it('swallows the error (does not throw) when the underlying updateMessage() call itself fails — this is the whole point of this method', async () => {
      mockMessageService.send.mockReturnValue(
        throwError(() => new Error('message service unreachable')),
      );

      await expect(
        service.tryUpdateMessage({
          id: 'msg-1',
          userId: 'bot-1',
          content: '⚠️ Lỗi: connect ECONNREFUSED',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('getRecentHistory — charBudget safety net', () => {
    it('does not trim anything when charBudget is not provided (existing behavior unchanged)', async () => {
      mockMessageService.send.mockReturnValue(
        of({
          messages: [
            { content: 'y'.repeat(100), sender: { isBot: false } },
            { content: 'x'.repeat(100), sender: { isBot: false } },
          ],
        }),
      );

      const history = await service.getRecentHistory({
        channelId: 'c1',
        userId: 'u1',
        beforeMessageId: 'm1',
        limit: 10,
      });

      expect(history).toHaveLength(2);
    });

    it('drops the oldest turns first once the total exceeds charBudget', async () => {
      mockMessageService.send.mockReturnValue(
        of({
          messages: [
            { content: 'newest turn', sender: { isBot: false } },
            {
              content: 'oldest turn should be dropped',
              sender: { isBot: false },
            },
          ],
        }),
      );

      const history = await service.getRecentHistory({
        channelId: 'c1',
        userId: 'u1',
        beforeMessageId: 'm1',
        limit: 10,
        charBudget: 15,
      });

      expect(history).toEqual([{ role: 'user', text: 'newest turn' }]);
    });

    it('always keeps at least the newest turn even if it alone exceeds charBudget', async () => {
      mockMessageService.send.mockReturnValue(
        of({
          messages: [{ content: 'x'.repeat(50), sender: { isBot: false } }],
        }),
      );

      const history = await service.getRecentHistory({
        channelId: 'c1',
        userId: 'u1',
        beforeMessageId: 'm1',
        limit: 10,
        charBudget: 5,
      });

      expect(history).toHaveLength(1);
    });
  });
});
