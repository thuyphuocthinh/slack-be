/**
 * Ném ra khi người dùng chủ động bấm Stop giữa lượt chat, phát hiện qua
 * AgentCancellationService (Redis flag khoá theo replyMessageId) — khác hẳn
 * ý NGHĨA với lỗi provider thật (timeout/network/...), AiOrchestrationProcessor
 * phải phân biệt bằng `instanceof` để hiện "Đã dừng theo yêu cầu" thay vì
 * thông báo lỗi.
 */
export class TurnCancelledError extends Error {
  /**
   * Phần nội dung đã stream ra CHO TỚI LÚC bị huỷ (nếu có) — dùng làm nội
   * dung lưu lại thay vì xoá sạch, giống ChatGPT/Claude: dừng thì giữ nguyên
   * phần đã có, không thay bằng 1 câu thông báo chung chung.
   */
  constructor(public readonly partialText?: string) {
    super('Turn cancelled by user');
    this.name = 'TurnCancelledError';
  }
}
