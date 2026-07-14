import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { TurnCancelledError } from '../llm/turn-cancelled.error';

// Redis là poll (không có cách "push" huỷ vào 1 Promise đang await SDK LLM),
// nên phải tự hỏi định kỳ. 1s đủ nhanh để cảm giác "Stop" phản hồi tức thời,
// không tốn quá nhiều round-trip Redis so với việc check mỗi token.
const POLL_INTERVAL_MS = 1000;

/**
 * Bọc quanh 1 lời gọi LLM (hoặc bất kỳ Promise dài nào) để có thể huỷ giữa
 * chừng: tạo 1 AbortController, định kỳ hỏi Redis (qua AgentCancellationService)
 * xem `messageId` này có bị yêu cầu dừng chưa — nếu có thì abort() ngay, khiến
 * `fn` (đang await SDK OpenAI/Anthropic/Gemini với `signal` này) reject ngay lập
 * tức thay vì phải đợi hết response. Chuẩn hoá mọi lỗi xảy ra SAU khi abort
 * thành `TurnCancelledError`, để tầng gọi không cần biết chi tiết lỗi gốc của
 * từng SDK khi bị abort ra sao.
 */
export async function runCancellable<T>(
  messageId: string,
  cancellation: AgentCancellationService,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();

  const interval = setInterval(() => {
    cancellation
      .isCancelled(messageId)
      .then((cancelled) => {
        if (cancelled) controller.abort();
      })
      .catch(() => {}); // Redis lỗi tạm thời không nên làm hỏng cả turn đang chạy
  }, POLL_INTERVAL_MS);

  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new TurnCancelledError();
    }
    throw error;
  } finally {
    clearInterval(interval);
  }
}
