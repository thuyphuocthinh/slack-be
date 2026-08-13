import { runCancellable, rethrowIfCancelled } from './cancellable-run.util';
import { TurnCancelledError } from '../llm/turn-cancelled.error';

describe('runCancellable', () => {
  const mockCancellation = { isCancelled: jest.fn().mockResolvedValue(false) };

  afterEach(() => jest.clearAllMocks());

  it('re-throws a TurnCancelledError already carrying partial content from fn() as-is, instead of overwriting it with buildCancelledError() (bug fix — Stop giữa lúc đang stream không được xoá mất phần đã stream)', async () => {
    const parentController = new AbortController();
    const fn = async () => {
      parentController.abort();
      throw new TurnCancelledError('phần đã stream được trước khi Stop');
    };
    const buildCancelledError = jest.fn(
      () => new TurnCancelledError('fallback — không nên dùng cái này'),
    );

    await expect(
      runCancellable(
        'msg-1',
        mockCancellation,
        fn,
        buildCancelledError,
        parentController.signal,
      ),
    ).rejects.toMatchObject({
      partialText: 'phần đã stream được trước khi Stop',
    });
    expect(buildCancelledError).not.toHaveBeenCalled();
  });

  it('falls back to buildCancelledError() when fn() throws a non-TurnCancelledError while aborted', async () => {
    const parentController = new AbortController();
    const fn = async () => {
      parentController.abort();
      throw new Error('SDK aborted mid-request');
    };
    const buildCancelledError = jest.fn(
      () => new TurnCancelledError('fallback text'),
    );

    await expect(
      runCancellable(
        'msg-1',
        mockCancellation,
        fn,
        buildCancelledError,
        parentController.signal,
      ),
    ).rejects.toMatchObject({ partialText: 'fallback text' });
    expect(buildCancelledError).toHaveBeenCalledTimes(1);
  });

  it('propagates a normal error untouched when it is unrelated to cancellation', async () => {
    const fn = async () => {
      throw new Error('lỗi thường, không liên quan Stop');
    };

    await expect(runCancellable('msg-1', mockCancellation, fn)).rejects.toThrow(
      'lỗi thường, không liên quan Stop',
    );
  });
});

describe('rethrowIfCancelled', () => {
  it('throws the same error when it is a TurnCancelledError', () => {
    const error = new TurnCancelledError('phần đã stream được');
    expect(() => rethrowIfCancelled(error)).toThrow(error);
  });

  it('does nothing (returns) for any other error', () => {
    expect(() => rethrowIfCancelled(new Error('lỗi thường'))).not.toThrow();
  });
});
