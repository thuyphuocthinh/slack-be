import { PendingToolCall } from '../entity/orchestration-checkpoint.entity';
import { ToolCallTraceDto } from '../dto/react-loop.dto';

/**
 * ReactLoopService throw lỗi này thay vì gọi tool thật khi gặp tool
 * `destructiveHint: true` (Giai đoạn 3 — Risk Gate). Khác hẳn Ý NGHĨA với lỗi
 * thật (external service error) — AiOrchestrationProcessor phải phân biệt
 * được bằng `instanceof` để dừng turn đúng cách (lưu checkpoint + tạo message
 * chờ duyệt) thay vì báo lỗi cho user.
 *
 * `toolCalls` mang theo các tool ĐÃ chạy thật thành công TRƯỚC tool bị chặn,
 * trong CÙNG 1 lượt turn (VD model xin gọi 2 tool 1 lúc, tool đầu an toàn đã
 * chạy xong, tool thứ 2 mới bị chặn) — thiếu field này thì kết quả tool đầu
 * bị rớt mất, không hiện trong timeline lẫn không được lưu vào checkpoint.
 */
export class ApprovalRequiredError extends Error {
  constructor(
    public readonly pendingTool: PendingToolCall,
    public readonly toolCalls: ToolCallTraceDto[] = [],
  ) {
    super(`Approval required for tool "${pendingTool.name}"`);
    this.name = 'ApprovalRequiredError';
  }
}
