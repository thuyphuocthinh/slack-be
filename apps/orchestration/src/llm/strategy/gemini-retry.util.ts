import { Logger } from '@nestjs/common';
import { abortableSleep } from '../../common/abortable-sleep.util';

/**
 * Gemini API thỉnh thoảng trả 429 (quota) hoặc 503 (server quá tải) — đều
 * là lỗi TẠM THỜI, tự hết sau vài giây. Dùng chung cho MỌI lời gọi Gemini
 * (chat lẫn structured output) — SDK Gemini không có retry built-in như
 * OpenAI/Anthropic SDK, phải tự viết, nhưng chỉ viết đúng 1 chỗ.
 */
export function isRetryableGeminiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\[(429|503)/.test(message) ||
    /Too Many Requests|Service Unavailable/i.test(message)
  );
}

export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  logger: Logger,
  maxAttempts = 3,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Đã bị huỷ (Stop) — đừng thử lại, cứ để lỗi bay thẳng lên cho
      // runCancellable() nhận ra signal.aborted và quy về TurnCancelledError.
      if (
        attempt === maxAttempts ||
        signal?.aborted ||
        !isRetryableGeminiError(error)
      ) {
        throw error;
      }
      const delayMs = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
      logger.warn(
        `Gemini call failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${(error as Error).message}`,
      );
      await abortableSleep(delayMs, signal);
    }
  }
  throw new Error('withGeminiRetry: unreachable');
}
