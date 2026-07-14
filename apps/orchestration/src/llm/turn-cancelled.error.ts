/**
 * Ném ra khi người dùng chủ động bấm Stop giữa lượt chat, phát hiện qua
 * AgentCancellationService (Redis flag khoá theo replyMessageId) — khác hẳn
 * ý NGHĨA với lỗi provider thật (timeout/network/...), AiOrchestrationProcessor
 * phải phân biệt bằng `instanceof` để hiện "Đã dừng theo yêu cầu" thay vì
 * thông báo lỗi.
 */
export class TurnCancelledError extends Error {
  constructor() {
    super('Turn cancelled by user');
    this.name = 'TurnCancelledError';
  }
}
