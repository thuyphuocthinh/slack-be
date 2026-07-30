import { withTimeout } from './with-timeout.util';
import { abortableSleep } from '../common/abortable-sleep.util';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';

interface WithLlmRetryOptions {
  signal?: AbortSignal;
  maxAttempts?: number;
  // Gọi SAU mỗi lần lỗi/timeout — trả false thì KHÔNG retry, ném lỗi ngay.
  // Bắt buộc cho lệnh gọi CÓ stream (đã lỡ stream vài token thì không được
  // retry mù nữa, xem constants.MAX_LLM_CALL_RETRY_ATTEMPTS).
  canRetry?: () => boolean;
}

/**
 * Retry cho lệnh gọi LLM (plan/evaluate/synthesize/ReactLoop sendMessage) khi
 * lỗi/timeout — an toàn vì bản thân việc "hỏi model trả lời gì" không có
 * side-effect thật (khác tool call, xem constants.MAX_LLM_CALL_RETRY_ATTEMPTS).
 *
 * `fn` nhận signal RIÊNG của từng lần thử — PHẢI truyền signal đó xuống
 * request thật (không phải `options.signal` gốc), để hết giờ ở lần thử N
 * thật sự huỷ được request đó, không để nó chạy ngầm trong lúc lần thử N+1
 * đã bắt đầu (2 request cùng lúc, có thể đẩy token/message trùng nhau).
 */
export async function withLlmRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  options?: WithLlmRetryOptions,
): Promise<T> {
  const { signal: callerSignal, canRetry } = options ?? {};
  const maxAttempts =
    options?.maxAttempts ?? ORCHESTRATION_CONSTANTS.MAX_LLM_CALL_RETRY_ATTEMPTS;

  let attempt = 0;
  while (true) {
    attempt++;
    if (callerSignal?.aborted) {
      throw new Error('Aborted');
    }
    const attemptController = new AbortController();
    const onCallerAbort = () => attemptController.abort();
    callerSignal?.addEventListener('abort', onCallerAbort);
    try {
      return await withTimeout(
        fn(attemptController.signal),
        timeoutMs,
        timeoutMessage,
        attemptController,
      );
    } catch (error) {
      if (callerSignal?.aborted) {
        throw error;
      }
      if (attempt >= maxAttempts || (canRetry && !canRetry())) {
        throw error;
      }
      await abortableSleep(
        ORCHESTRATION_CONSTANTS.LLM_CALL_RETRY_BACKOFF_MS,
        callerSignal,
      );
    } finally {
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }
}
