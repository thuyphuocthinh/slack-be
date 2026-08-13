import { abortableSleep } from './abortable-sleep.util';

describe('abortableSleep', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves after the given delay when never aborted', async () => {
    const assertion = expect(abortableSleep(1000)).resolves.toBeUndefined();
    jest.advanceTimersByTime(1000);
    await assertion;
  });

  it('resolves fine when no signal is passed at all (optional param)', async () => {
    const assertion = expect(
      abortableSleep(500, undefined),
    ).resolves.toBeUndefined();
    jest.advanceTimersByTime(500);
    await assertion;
  });

  // Bug thật đã sửa: Stop giữa turn trước đây không cắt được backoff giữa 2
  // lần retry (MCP call/tool call) — người dùng phải đợi hết delay rồi mới
  // thấy tác dụng của Stop.
  it('rejects NGAY LẬP TỨC khi signal bị abort GIỮA lúc đang chờ, không đợi hết thời gian delay', async () => {
    const controller = new AbortController();
    const promise = abortableSleep(10_000, controller.signal);
    const assertion = expect(promise).rejects.toThrow('Aborted');

    // Chỉ trôi 1s trong tổng 10s hẹn giờ — nếu abortableSleep KHÔNG lắng nghe
    // signal, promise này sẽ còn treo tới hết 10s.
    jest.advanceTimersByTime(1000);
    controller.abort();
    await assertion;
  });

  it('rejects ngay (không hẹn giờ) khi signal ĐÃ bị abort TỪ TRƯỚC khi gọi', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(abortableSleep(10_000, controller.signal)).rejects.toThrow(
      'Aborted',
    );
  });

  it('không rò rỉ timer sau khi resolve bình thường (removeEventListener đã được gọi)', async () => {
    const controller = new AbortController();
    const removeSpy = jest.spyOn(controller.signal, 'removeEventListener');

    const assertion = expect(
      abortableSleep(1000, controller.signal),
    ).resolves.toBeUndefined();
    jest.advanceTimersByTime(1000);
    await assertion;

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
