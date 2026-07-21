import { Test, TestingModule } from '@nestjs/testing';
import { ESocketEvent } from '@slack/constants';
import { EJobName, EQueueName, QueueService } from '@slack/queue';
import { AgentStreamService, DEFAULT_STREAM_KEY } from './agent-stream.service';

describe('AgentStreamService', () => {
  let service: AgentStreamService;

  const mockQueueService = { addJob: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentStreamService,
        { provide: QueueService, useValue: mockQueueService },
      ],
    }).compile();

    service = module.get<AgentStreamService>(AgentStreamService);
  });

  afterEach(() => jest.clearAllMocks());

  it('emits only to the personal room for a DIRECT channel', async () => {
    await service.emitStep(
      {
        userId: 'user-1',
        channelId: 'channel-1',
        messageId: 'msg-1',
        channelType: 'direct',
      },
      { type: 'tool_call', tool: 'get_schema' },
    );

    expect(mockQueueService.addJob).toHaveBeenCalledTimes(1);
    expect(mockQueueService.addJob).toHaveBeenCalledWith(
      EQueueName.SOCKET_QUEUE,
      EJobName.EMIT_EVENT,
      expect.objectContaining({
        event: ESocketEvent.AGENT_STREAM,
        room: 'user_user-1',
        data: {
          type: 'tool_call',
          tool: 'get_schema',
          channelId: 'channel-1',
          messageId: 'msg-1',
          streamKey: DEFAULT_STREAM_KEY,
          seq: 1,
        },
      }),
    );
  });

  it('emits only to the personal room for a GROUP channel too — no channel/group broadcast', async () => {
    await service.emitStep(
      {
        userId: 'user-1',
        channelId: 'channel-1',
        messageId: 'msg-1',
        channelType: 'group',
      },
      {
        type: 'tool_result',
        tool: 'get_schema',
        status: 'success',
        resultPreview: 'ok',
      },
    );

    expect(mockQueueService.addJob).toHaveBeenCalledTimes(1);
    expect(mockQueueService.addJob).toHaveBeenCalledWith(
      EQueueName.SOCKET_QUEUE,
      EJobName.EMIT_EVENT,
      expect.objectContaining({ room: 'user_user-1' }),
    );
  });

  it('emits a "done" step the same way as any other step type', async () => {
    await service.emitStep(
      {
        userId: 'user-1',
        channelId: 'channel-1',
        messageId: 'msg-1',
        channelType: 'direct',
      },
      { type: 'done' },
    );

    expect(mockQueueService.addJob).toHaveBeenCalledWith(
      EQueueName.SOCKET_QUEUE,
      EJobName.EMIT_EVENT,
      expect.objectContaining({
        room: 'user_user-1',
        data: expect.objectContaining({ type: 'done' }),
      }),
    );
  });

  // Bug thật (session 2026-07-20, log production) — mỗi chunk SSE của provider
  // (thường vài ký tự) từng đẩy thẳng 1 job Redis/BullMQ riêng: 1 câu trả lời
  // dài sinh HÀNG TRĂM job trong vài giây, không chịu nổi nhiều turn đồng thời.
  describe('gộp nhiều token chunk liên tiếp thành 1 job (chịu tải nhiều turn đồng thời)', () => {
    const ctx = {
      userId: 'user-1',
      channelId: 'channel-1',
      messageId: 'msg-1',
      channelType: 'direct' as const,
    };

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('KHÔNG emit ngay lập tức khi nhận 1 chunk "token" — chờ gộp trước', async () => {
      await service.emitStep(ctx, { type: 'token', text: 'hi' });

      expect(mockQueueService.addJob).not.toHaveBeenCalled();
    });

    it('gộp nhiều chunk "token" liên tiếp (cùng messageId + streamKey) thành ĐÚNG 1 job, nối text theo thứ tự', async () => {
      await service.emitStep(ctx, { type: 'token', text: 'Xin ' });
      await service.emitStep(ctx, { type: 'token', text: 'chào ' });
      await service.emitStep(ctx, { type: 'token', text: 'bạn!' });

      expect(mockQueueService.addJob).not.toHaveBeenCalled();

      jest.runOnlyPendingTimers();
      await Promise.resolve();

      expect(mockQueueService.addJob).toHaveBeenCalledTimes(1);
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'token',
            text: 'Xin chào bạn!',
          }),
        }),
      );
    });

    it('defaults streamKey to DEFAULT_STREAM_KEY when the context does not specify one', async () => {
      await service.emitStep(ctx, { type: 'token', text: 'hi' });
      jest.runOnlyPendingTimers();
      await Promise.resolve();

      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        expect.objectContaining({
          data: expect.objectContaining({ streamKey: DEFAULT_STREAM_KEY }),
        }),
      );
    });

    it('passes through a caller-supplied streamKey untouched (Supervisor fan-out — multiple ReactLoop runs on the same messageId)', async () => {
      await service.emitStep(
        { ...ctx, streamKey: 'r0-sql_server' },
        { type: 'token', text: 'hi' },
      );
      jest.runOnlyPendingTimers();
      await Promise.resolve();

      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        expect.objectContaining({
          data: expect.objectContaining({ streamKey: 'r0-sql_server' }),
        }),
      );
    });

    it('KHÔNG gộp lẫn token của 2 streamKey khác nhau cùng messageId (Supervisor fan-out song song)', async () => {
      await service.emitStep(
        { ...ctx, streamKey: 'r0-sql_server' },
        { type: 'token', text: 'sql ' },
      );
      await service.emitStep(
        { ...ctx, streamKey: 'r0-github' },
        { type: 'token', text: 'github ' },
      );

      jest.runOnlyPendingTimers();
      await Promise.resolve();

      expect(mockQueueService.addJob).toHaveBeenCalledTimes(2);
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        expect.objectContaining({
          data: expect.objectContaining({
            streamKey: 'r0-sql_server',
            text: 'sql ',
          }),
        }),
      );
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        expect.objectContaining({
          data: expect.objectContaining({
            streamKey: 'r0-github',
            text: 'github ',
          }),
        }),
      );
    });

    it('xả (flush) hết token đang gộp dở NGAY khi gặp 1 step khác "token" — giữ đúng thứ tự event, không đợi hết ngưỡng thời gian', async () => {
      await service.emitStep(ctx, {
        type: 'token',
        text: 'để tôi kiểm tra...',
      });
      // resync() gọi ngay sau khi model quyết định gọi tool — PHẢI thấy đúng
      // đoạn token vừa gộp TRƯỚC nó, không được đợi thêm TOKEN_BATCH_FLUSH_MS.
      await service.emitStep(ctx, { type: 'resync', text: '' });

      expect(mockQueueService.addJob).toHaveBeenCalledTimes(2);
      const [firstCall, secondCall] = mockQueueService.addJob.mock.calls;
      expect(firstCall[2]).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'token',
            text: 'để tôi kiểm tra...',
          }),
        }),
      );
      expect(secondCall[2]).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'resync', text: '' }),
        }),
      );
    });

    it('không emit job token rỗng nếu chưa từng có chunk "token" nào trước 1 step khác', async () => {
      await service.emitStep(ctx, { type: 'tool_call', tool: 'get_schema' });

      expect(mockQueueService.addJob).toHaveBeenCalledTimes(1);
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        expect.objectContaining({
          data: expect.objectContaining({ type: 'tool_call' }),
        }),
      );
    });

    it('onModuleDestroy() xả nốt token còn dở — không mất đoạn cuối khi app tắt giữa lúc đang stream', async () => {
      await service.emitStep(ctx, {
        type: 'token',
        text: 'đoạn cuối chưa kịp flush',
      });
      expect(mockQueueService.addJob).not.toHaveBeenCalled();

      await service.onModuleDestroy();

      expect(mockQueueService.addJob).toHaveBeenCalledTimes(1);
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'token',
            text: 'đoạn cuối chưa kịp flush',
          }),
        }),
      );
    });
  });

  // SocketProcessor (app socket-gateway, concurrency=20) có thể xử lý nhiều
  // job của CÙNG 1 stream không đúng thứ tự enqueue — `seq` tăng dần theo
  // ĐÚNG thứ tự emitStep() được gọi để processor tự sắp lại trước khi emit ra
  // socket thật (xem socket.processor.spec.ts cho phần sắp thứ tự đó).
  describe('đánh số seq tăng dần cho SocketProcessor tự sắp lại đúng thứ tự', () => {
    const ctx = {
      userId: 'user-1',
      channelId: 'channel-1',
      messageId: 'msg-1',
      channelType: 'direct' as const,
    };

    it('tăng dần đúng thứ tự cho nhiều step liên tiếp CÙNG 1 key (messageId+streamKey)', async () => {
      await service.emitStep(ctx, { type: 'tool_call', tool: 'a' });
      await service.emitStep(ctx, {
        type: 'tool_result',
        tool: 'a',
        status: 'success',
      });

      expect(mockQueueService.addJob.mock.calls[0][2].data.seq).toBe(1);
      expect(mockQueueService.addJob.mock.calls[1][2].data.seq).toBe(2);
    });

    it('đếm ĐỘC LẬP theo từng streamKey — 2 stream khác nhau cùng messageId không lẫn số thứ tự của nhau', async () => {
      await service.emitStep(
        { ...ctx, streamKey: 'r0-sql' },
        { type: 'tool_call', tool: 'sql' },
      );
      await service.emitStep(
        { ...ctx, streamKey: 'r0-github' },
        { type: 'tool_call', tool: 'gh' },
      );
      await service.emitStep(
        { ...ctx, streamKey: 'r0-sql' },
        { type: 'tool_result', tool: 'sql', status: 'success' },
      );

      expect(mockQueueService.addJob.mock.calls[0][2].data.seq).toBe(1); // r0-sql lần 1
      expect(mockQueueService.addJob.mock.calls[1][2].data.seq).toBe(1); // r0-github lần 1, độc lập
      expect(mockQueueService.addJob.mock.calls[2][2].data.seq).toBe(2); // r0-sql lần 2
    });

    it('bắt đầu lại từ 1 sau khi step "done" đã emit — dọn state ngay, không tích luỹ mãi qua nhiều turn', async () => {
      await service.emitStep(ctx, { type: 'tool_call', tool: 'a' });
      await service.emitStep(ctx, { type: 'done' });
      await service.emitStep(ctx, { type: 'tool_call', tool: 'b' });

      expect(mockQueueService.addJob.mock.calls[2][2].data.seq).toBe(1);
    });
  });
});
