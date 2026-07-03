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
        { provide: NAME_SERVICE_TCP.MESSAGE_SERVICE, useValue: mockMessageService },
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
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'liệt kê danh sách đơn hàng' }] }],
          },
        }),
      );

      const text = await service.getMessageText({ id: 'msg-1', userId: 'user-1' });

      expect(text).toBe('liệt kê danh sách đơn hàng');
    });

    it('joins multiple text nodes across nested paragraphs/marks with a space', async () => {
      mockMessageService.send.mockReturnValue(
        of({
          content: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: 'world' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'second line' }] },
            ],
          },
        }),
      );

      const text = await service.getMessageText({ id: 'msg-1', userId: 'user-1' });

      expect(text).toBe('Hello world second line');
    });

    it('returns a plain string as-is when it is genuinely plain text, not JSON (bot-authored messages)', async () => {
      mockMessageService.send.mockReturnValue(of({ content: 'Xin chào! Mình có thể giúp gì cho bạn hôm nay?' }));

      const text = await service.getMessageText({ id: 'msg-1', userId: 'user-1' });

      expect(text).toBe('Xin chào! Mình có thể giúp gì cho bạn hôm nay?');
    });

    it('parses a JSON-string-encoded TipTap doc too, in case content ever arrives un-parsed', async () => {
      mockMessageService.send.mockReturnValue(
        of({ content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'raw json string' }] }] }) }),
      );

      const text = await service.getMessageText({ id: 'msg-1', userId: 'user-1' });

      expect(text).toBe('raw json string');
    });

    it('returns empty string for content with no text nodes (VD chỉ có mention/image)', async () => {
      mockMessageService.send.mockReturnValue(
        of({ content: { type: 'doc', content: [{ type: 'mention', attrs: { id: 'u1', label: 'someone' } }] } }),
      );

      const text = await service.getMessageText({ id: 'msg-1', userId: 'user-1' });

      expect(text).toBe('');
    });
  });

  describe('getRecentHistory', () => {
    it('extracts text per message and filters out turns with no extractable text', async () => {
      mockMessageService.send.mockReturnValue(
        of({
          messages: [
            { content: 'AI reply mới nhất', sender: { isBot: true } },
            { content: { type: 'doc', content: [{ type: 'mention', attrs: {} }] }, sender: { isBot: false } }, // rỗng, bị lọc
            {
              content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'câu hỏi trước đó' }] }] },
              sender: { isBot: false },
            },
          ],
        }),
      );

      const history = await service.getRecentHistory({ channelId: 'c1', userId: 'u1', beforeMessageId: 'm1', limit: 10 });

      // đảo DESC -> ASC (cũ -> mới) rồi lọc rỗng
      expect(history).toEqual([
        { role: 'user', text: 'câu hỏi trước đó' },
        { role: 'model', text: 'AI reply mới nhất' },
      ]);
    });
  });
});
