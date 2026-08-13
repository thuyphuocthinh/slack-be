import { Logger } from '@nestjs/common';
import { withGeminiRetry } from './gemini-retry.util';

describe('withGeminiRetry', () => {
  const logger = new Logger('test');

  afterEach(() => jest.useRealTimers());

  it('retries a transient (503) error and succeeds', async () => {
    jest.useFakeTimers();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('[503] Service Unavailable'))
      .mockResolvedValueOnce('ok');

    const promise = withGeminiRetry(fn, logger);
    await jest.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient error', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('invalid_argument'));

    await expect(withGeminiRetry(fn, logger)).rejects.toThrow(
      'invalid_argument',
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('aborts immediately during the backoff sleep instead of waiting out the full delay', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const fn = jest
      .fn()
      .mockRejectedValue(new Error('[503] Service Unavailable'));

    const promise = withGeminiRetry(fn, logger, 3, controller.signal);
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(promise).rejects.toThrow('Aborted');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
