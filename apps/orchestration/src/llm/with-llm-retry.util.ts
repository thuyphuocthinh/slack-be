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
 */
export async function withLlmRetry<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  options?: WithLlmRetryOptions,
): Promise<T> {
  const { signal, canRetry } = options ?? {};
  const maxAttempts =
    options?.maxAttempts ?? ORCHESTRATION_CONSTANTS.MAX_LLM_CALL_RETRY_ATTEMPTS;

  let attempt = 0;
  while (true) {
    attempt++;
    if (signal?.aborted) {
      throw new Error('Aborted');
    }
    try {
      return await withTimeout(fn(), timeoutMs, timeoutMessage);
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      if (attempt >= maxAttempts || (canRetry && !canRetry())) {
        throw error;
      }
      await abortableSleep(
        ORCHESTRATION_CONSTANTS.LLM_CALL_RETRY_BACKOFF_MS,
        signal,
      );
    }
  }
}
