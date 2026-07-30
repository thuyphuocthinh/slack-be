import { withLlmRetry } from './with-llm-retry.util';

describe('withLlmRetry', () => {
  it('returns the result on the first try when fn succeeds', async () => {
    const fn = jest.fn().mockResolvedValue('ok');

    const result = await withLlmRetry(fn, 1000, 'timeout');

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once and succeeds when the first attempt fails', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('LLM provider is down'))
      .mockResolvedValueOnce('ok');

    const result = await withLlmRetry(fn, 1000, 'timeout');

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting maxAttempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('LLM provider is down'));

    await expect(
      withLlmRetry(fn, 1000, 'timeout', { maxAttempts: 2 }),
    ).rejects.toThrow('LLM provider is down');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry when canRetry() returns false (VD đã lỡ stream vài token)', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('stream stalled'));

    await expect(
      withLlmRetry(fn, 1000, 'timeout', { canRetry: () => false }),
    ).rejects.toThrow('stream stalled');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the signal is already aborted before the first attempt', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = jest.fn().mockResolvedValue('ok');

    await expect(
      withLlmRetry(fn, 1000, 'timeout', { signal: controller.signal }),
    ).rejects.toThrow('Aborted');
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not retry when the signal is aborted after the first attempt fails', async () => {
    const controller = new AbortController();
    const fn = jest.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error('connection reset'));
    });

    await expect(
      withLlmRetry(fn, 1000, 'timeout', { signal: controller.signal }),
    ).rejects.toThrow('connection reset');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('propagates the original timeout error message when withTimeout() fires', async () => {
    const fn = jest.fn().mockImplementation(() => new Promise(() => {})); // never resolves

    await expect(
      withLlmRetry(fn, 10, 'custom timeout message', { maxAttempts: 1 }),
    ).rejects.toThrow('custom timeout message');
  });

  it('aborts the per-attempt signal on timeout, so the caller stops the underlying request instead of leaving it running (bug fix)', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fn = jest.fn().mockImplementation((signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise(() => {}); // never resolves — simula treo tới timeout
    });

    await expect(
      withLlmRetry(fn, 10, 'timeout', { maxAttempts: 1 }),
    ).rejects.toThrow('timeout');

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('gives each retry attempt its OWN signal, not the same aborted one from the previous timed-out attempt', async () => {
    const signals: AbortSignal[] = [];
    const fn = jest
      .fn()
      .mockImplementationOnce((signal: AbortSignal) => {
        signals.push(signal);
        return new Promise(() => {}); // treo tới timeout ở lần thử 1
      })
      .mockImplementationOnce((signal: AbortSignal) => {
        signals.push(signal);
        return Promise.resolve('ok');
      });

    const result = await withLlmRetry(fn, 10, 'timeout');

    expect(result).toBe('ok');
    expect(signals[0].aborted).toBe(true); // lần 1 đã bị abort do timeout
    expect(signals[1]).not.toBe(signals[0]); // lần 2 dùng signal MỚI, không kế thừa trạng thái aborted
    expect(signals[1].aborted).toBe(false);
  });

  it('aborts the current attempt signal when the caller signal aborts mid-attempt', async () => {
    const callerController = new AbortController();
    let attemptSignal: AbortSignal | undefined;
    const fn = jest.fn().mockImplementation((signal: AbortSignal) => {
      attemptSignal = signal;
      callerController.abort();
      return new Promise(() => {});
    });

    await expect(
      withLlmRetry(fn, 50, 'timeout', { signal: callerController.signal }),
    ).rejects.toThrow();

    expect(attemptSignal?.aborted).toBe(true);
  });
});
