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
});
