import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { NAME_SERVICE_TCP } from '@slack/constants';
import { MessageClientService } from './message-client.service';

describe('MessageClientService', () => {
  let service: MessageClientService;
  const mockMessageService = { send: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageClientService,
        {
          provide: NAME_SERVICE_TCP.MESSAGE_SERVICE,
          useValue: mockMessageService,
        },
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

      // đảo DESC -> ASC (cũ -> mới) rồi lọc rỗng
      expect(history).toEqual([
        { role: 'user', text: 'câu hỏi trước đó' },
        { role: 'model', text: 'AI reply mới nhất' },
      ]);
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
    });
  });
});
