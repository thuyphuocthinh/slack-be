import { ToolCallTraceDto } from '../dto/react-loop.dto';
import { SupervisorRoundDto } from '../dto/supervisor.dto';
import { PendingToolCall } from '../entity/orchestration-checkpoint.entity';

// Object content (approval_request) đi qua createMessage() riêng, không qua đây.
export interface AnswerResult {
  content: string;
  toolCalls?: ToolCallTraceDto[];
}

export interface DelegateRoundResult {
  round: SupervisorRoundDto;
  toolCalls: ToolCallTraceDto[];
}

// delegateRound() trả dạng này thay vì throw khi bị Risk Gate chặn, để
// Promise.all() không mất kết quả của delegation anh em chạy song song.
export interface ApprovalRequiredDelegateResult {
  approvalRequired: PendingToolCall;
  task: string;
  toolCalls: ToolCallTraceDto[];
}

// executeApprovedTool() trả dạng này thay vì throw khi vòng resume (sau khi
// duyệt hành động ĐẦU) lại gặp thêm 1 tool rủi ro KHÁC — approveCheckpoint()
// cần cả kết quả hành động đầu (`firstActionResult`) để ghép vào lịch sử round
// trước khi tạo checkpoint mới nối tiếp (xem pauseForApproval()).
export interface ApprovalRequiredResumeResult {
  approvalRequired: PendingToolCall;
  task: string;
  toolCalls: ToolCallTraceDto[];
  firstActionResult: string;
}

export function buildAnswer(
  content: string,
  toolCalls: ToolCallTraceDto[],
): AnswerResult {
  return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}
