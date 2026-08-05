import { EStepExecutionStatus, EMessageRole } from '@slack/constants';
export class CreateOrchestrationMessageRequestDto {
  channelId: string;
  senderId: string;
  // object — Giai đoạn 3 (HITL) dùng để tạo message "approval_request"
  // ({type, tool, args, status}), không chỉ text thường.
  content: string | Record<string, unknown>;
}

export class CreateOrchestrationMessageResponseDto {
  id: string;
}

export class UpdateOrchestrationMessageRequestDto {
  id: string;
  userId: string;
  // object — Giai đoạn 3 (HITL) cần re-send content dạng object khi update
  // message "approval_request" kèm toolCalls (xem pauseForApproval()).
  content: string | Record<string, unknown>;
  toolCalls?: {
    tool: string;
    status: EStepExecutionStatus;
    resultPreview?: string;
  }[];
  // ver3.md mục 1 (dài hạn) — optional CÓ CHỦ ĐÍCH: chỉ cần truyền ở các call
  // site có toolCalls thật (nơi có thể phát sinh ghi nhớ channel_memory), các
  // nhánh lỗi chỉ update text bỏ qua an toàn (không channelId → updateMessage()
  // tự bỏ qua bước ghi channel_memory).
  channelId?: string;
  executionTimeMs?: number;
}

export class GetMessageTextRequestDto {
  id: string;
  userId: string;
}

export class GetRecentHistoryRequestDto {
  channelId: string;
  userId: string;
  // Chỉ lấy message TRƯỚC message này (không tính chính nó)
  beforeMessageId: string;
  limit: number;
  // Giai đoạn 2 (Agent OS) — lưới an toàn ký tự cuối cùng (xem
  // resolveHistoryCharBudget), KHÔNG thay cơ chế turn-count hiện có. Không
  // truyền = giữ nguyên hành vi cũ (không cắt thêm theo ký tự).
  charBudget?: number;
}

export class ChatHistoryTurnDto {
  role: EMessageRole;
  text: string;
}
