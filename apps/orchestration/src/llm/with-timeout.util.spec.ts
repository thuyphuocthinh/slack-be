import { withTimeout } from './with-timeout.util';

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves with the original value when the promise settles before the deadline', async () => {
    const promise = withTimeout(Promise.resolve('ok'), 1000, 'timeout');
    await expect(promise).resolves.toBe('ok');
  });

  it('rejects with the original error when the promise rejects before the deadline', async () => {
    const promise = withTimeout(Promise.reject(new Error('boom')), 1000, 'timeout');
    await expect(promise).rejects.toThrow('boom');
  });

  it('rejects with the timeout message when the promise never settles before the deadline (VD provider treo vô thời hạn)', async () => {
    const neverResolves = new Promise(() => {});
    const promise = withTimeout(neverResolves, 1000, 'gave up after 1s');

    const assertion = expect(promise).rejects.toThrow('gave up after 1s');
    jest.advanceTimersByTime(1000);
    await assertion;
  });
});
