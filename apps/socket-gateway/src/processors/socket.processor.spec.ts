import { Job } from 'bullmq';
import { EJobName, IEmitEventJobData, IEmitToUsersJobData } from '@slack/queue';
import { ESocketEvent } from '@slack/constants';
import { SocketProcessor } from './socket.processor';
import { SocketGateway } from '../gateway/socket.gateway';

describe('SocketProcessor', () => {
  let processor: SocketProcessor;
  let emit: jest.Mock;
  let to: jest.Mock;
  let mockGateway: SocketGateway;

  const emitEventJob = (
    data: Record<string, unknown>,
    room = 'user_user-1',
  ): Job<IEmitEventJobData, string, EJobName> =>
    ({
      id: 'job-1',
      name: EJobName.EMIT_EVENT,
      data: { event: ESocketEvent.AGENT_STREAM, room, data },
    }) as unknown as Job<IEmitEventJobData, string, EJobName>;

  beforeEach(() => {
    emit = jest.fn();
    to = jest.fn().mockReturnValue({ emit });
    mockGateway = { server: { to, emit } } as unknown as SocketGateway;
    processor = new SocketProcessor(mockGateway);
  });

  afterEach(() => {
    processor.onModuleDestroy();
    jest.useRealTimers();
  });

  // Bug thật đã sửa: SocketProcessor xử lý SOCKET_QUEUE với concurrency=20 —
  // nhiều job của CÙNG 1 stream (messageId+streamKey) có thể được xử lý không
  // đúng thứ tự enqueue nếu rơi vào worker slot khác nhau. AgentStreamService
  // đã đánh số `seq` tăng dần — processor phải tự sắp lại đúng thứ tự trước
  // khi thật sự emit ra socket.

  it('emits AGENT_STREAM events đúng thứ tự khi job tới ĐÚNG thứ tự seq', async () => {
    await processor.process(
      emitEventJob({ type: 'token', text: 'a', messageId: 'msg-1', seq: 1 }),
    );
    await processor.process(
      emitEventJob({ type: 'token', text: 'b', messageId: 'msg-1', seq: 2 }),
    );

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0][1]).toEqual(
      expect.objectContaining({ text: 'a', seq: 1 }),
    );
    expect(emit.mock.calls[1][1]).toEqual(
      expect.objectContaining({ text: 'b', seq: 2 }),
    );
  });

  it('giữ lại (KHÔNG emit ngay) job tới SỚM hơn seq đang chờ, rồi xả đúng thứ tự khi seq còn thiếu tới sau', async () => {
    // seq=2 tới TRƯỚC seq=1 (mô phỏng đúng bug: job xử lý xong không theo thứ tự enqueue).
    await processor.process(
      emitEventJob({ type: 'token', text: 'b', messageId: 'msg-1', seq: 2 }),
    );
    expect(emit).not.toHaveBeenCalled();

    await processor.process(
      emitEventJob({ type: 'token', text: 'a', messageId: 'msg-1', seq: 1 }),
    );

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0][1]).toEqual(
      expect.objectContaining({ text: 'a', seq: 1 }),
    );
    expect(emit.mock.calls[1][1]).toEqual(
      expect.objectContaining({ text: 'b', seq: 2 }),
    );
  });

  it('xả đúng thứ tự nhiều seq đã tới sớm cùng lúc, không chỉ đúng 1 seq kế tiếp', async () => {
    await processor.process(
      emitEventJob({ type: 'token', text: 'c', messageId: 'msg-1', seq: 3 }),
    );
    await processor.process(
      emitEventJob({ type: 'token', text: 'b', messageId: 'msg-1', seq: 2 }),
    );
    expect(emit).not.toHaveBeenCalled();

    await processor.process(
      emitEventJob({ type: 'token', text: 'a', messageId: 'msg-1', seq: 1 }),
    );

    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit.mock.calls.map((call) => call[1].text)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('bỏ qua (không emit lại) job có seq CŨ hơn seq đang chờ — BullMQ retry job đã emit rồi', async () => {
    await processor.process(
      emitEventJob({ type: 'token', text: 'a', messageId: 'msg-1', seq: 1 }),
    );
    await processor.process(
      emitEventJob({
        type: 'token',
        text: 'a-retry',
        messageId: 'msg-1',
        seq: 1,
      }),
    );

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('cô lập đúng theo streamKey — 2 stream khác nhau cùng messageId không lẫn thứ tự của nhau', async () => {
    await processor.process(
      emitEventJob({
        type: 'token',
        text: 'sql-2',
        messageId: 'msg-1',
        streamKey: 'r0-sql',
        seq: 2,
      }),
    );
    await processor.process(
      emitEventJob({
        type: 'token',
        text: 'gh-1',
        messageId: 'msg-1',
        streamKey: 'r0-github',
        seq: 1,
      }),
    );

    // r0-github seq=1 emit ngay (đúng lượt của chính stream nó); r0-sql seq=2
    // vẫn phải chờ seq=1 CỦA RIÊNG NÓ, không bị ảnh hưởng bởi r0-github.
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][1]).toEqual(
      expect.objectContaining({ text: 'gh-1' }),
    );
  });

  it('dọn state ngay khi gặp step "done" — seq sau đó (VD stream mới cùng key) coi như bắt đầu lại từ đầu', async () => {
    await processor.process(
      emitEventJob({ type: 'token', text: 'a', messageId: 'msg-1', seq: 1 }),
    );
    await processor.process(
      emitEventJob({ type: 'done', messageId: 'msg-1', seq: 2 }),
    );
    emit.mockClear();

    await processor.process(
      emitEventJob({
        type: 'token',
        text: 'new-stream',
        messageId: 'msg-1',
        seq: 1,
      }),
    );

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][1]).toEqual(
      expect.objectContaining({ text: 'new-stream' }),
    );
  });

  it('emit ngay lập tức, không áp dụng cơ chế sắp thứ tự, cho event KHÔNG PHẢI AGENT_STREAM', async () => {
    const job = {
      id: 'job-1',
      name: EJobName.EMIT_EVENT,
      data: {
        event: 'message_created',
        room: 'channel_1',
        data: { text: 'hi' },
      },
    } as unknown as Job<IEmitEventJobData, string, EJobName>;

    await processor.process(job);

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('emit ngay lập tức cho AGENT_STREAM thiếu seq/messageId (fallback an toàn, không rơi vào cơ chế sắp thứ tự)', async () => {
    const job = {
      id: 'job-1',
      name: EJobName.EMIT_EVENT,
      data: {
        event: ESocketEvent.AGENT_STREAM,
        room: 'user_user-1',
        data: { type: 'token', text: 'no-seq' },
      },
    } as unknown as Job<IEmitEventJobData, string, EJobName>;

    await processor.process(job);

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('vẫn xử lý EMIT_TO_USERS như cũ, không bị ảnh hưởng bởi cơ chế sắp thứ tự (chỉ áp dụng cho EMIT_EVENT)', async () => {
    const job = {
      id: 'job-1',
      name: EJobName.EMIT_TO_USERS,
      data: {
        event: 'notification',
        userIds: ['u1', 'u2'],
        data: { text: 'hi' },
      },
    } as unknown as Job<IEmitToUsersJobData, string, EJobName>;

    await processor.process(job);

    expect(to).toHaveBeenCalledWith('user_u1');
    expect(to).toHaveBeenCalledWith('user_u2');
    expect(emit).toHaveBeenCalledTimes(2);
  });

  describe('sweep định kỳ (job bị mất vĩnh viễn)', () => {
    beforeEach(() => {
      // Dọn processor thật (real timers) mà beforeEach ngoài cùng vừa tạo,
      // tránh rò rỉ 1 setInterval thật chạy song song không cần thiết.
      processor.onModuleDestroy();
      jest.useFakeTimers();
      processor = new SocketProcessor(mockGateway);
    });

    it('quá thời gian chờ (job seq còn thiếu bị mất vĩnh viễn) thì xả nốt buffer theo thứ tự best-effort thay vì kẹt mãi', async () => {
      // seq=1 KHÔNG BAO GIỜ tới (job fail hết retry) — seq=2,3 tới trước, phải kẹt trong buffer.
      await processor.process(
        emitEventJob({ type: 'token', text: 'b', messageId: 'msg-1', seq: 2 }),
      );
      await processor.process(
        emitEventJob({ type: 'token', text: 'c', messageId: 'msg-1', seq: 3 }),
      );
      expect(emit).not.toHaveBeenCalled();

      // Sweep chạy ĐỊNH KỲ mỗi STREAM_ORDER_SWEEP_INTERVAL_MS (10s) — tick đầu
      // tiên ở đúng t=10s có thể chưa vượt ngưỡng "cũ hơn 10s" (bằng, không lớn
      // hơn), nên cần tối thiểu 2 chu kỳ để chắc chắn bắt được.
      jest.advanceTimersByTime(21_000);

      expect(emit).toHaveBeenCalledTimes(2);
      expect(emit.mock.calls.map((call) => call[1].text)).toEqual(['b', 'c']);
    });
  });
});
