import {
  AmbiguousAgentCandidate,
  OrchestrationCheckpointStatus,
  PendingToolCall,
} from '../entity/orchestration-checkpoint.entity';
import { DelegationDto, SupervisorRoundDto } from './supervisor.dto';
import { ChatHistoryTurnDto } from './message-client.dto';

export class CreateCheckpointRequestDto {
  replyMessageId: string;
  userId: string;
  botUserId: string;
  channelId: string;
  workspaceId: string;
  channelType: string;
  originalPrompt: string;
  // accuracy_problem.md mục 1 — null khi kind='clarification' (chưa gắn với
  // tool call cụ thể nào).
  pendingTool: PendingToolCall | null;
  pendingTask: string;
  roundsSoFar: SupervisorRoundDto[];
  history: ChatHistoryTurnDto[];
  kind?: 'approval' | 'clarification';
  clarificationQuestion?: string | null;
  clarificationCandidates?: AmbiguousAgentCandidate[] | null;
  // accuracy_problem.md mục 9.2 — mặc định [] nếu không truyền (checkpoint
  // 'clarification' hiện chưa dùng field này).
  remainingSteps?: DelegationDto[];
}

// Response cho create()/findPendingByReplyMessageId()/findById()/findExpiredPending()
// — không trả thẳng OrchestrationCheckpointEntity (ORM) ra ngoài CheckpointService.
export class CheckpointResponseDto {
  id: string;
  replyMessageId: string;
  userId: string;
  botUserId: string;
  channelId: string;
  workspaceId: string;
  channelType: string;
  originalPrompt: string;
  pendingTool: PendingToolCall | null;
  pendingTask: string;
  roundsSoFar: SupervisorRoundDto[];
  remainingSteps: DelegationDto[];
  history: ChatHistoryTurnDto[];
  status: OrchestrationCheckpointStatus;
  kind: 'approval' | 'clarification';
  clarificationQuestion: string | null;
  clarificationCandidates: AmbiguousAgentCandidate[] | null;
  selectedProvider: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class FindPendingCheckpointRequestDto {
  replyMessageId: string;
}

// Giai đoạn 3 (HITL) — dùng trong job PROCESS_APPROVAL để fetch lại checkpoint
// SAU khi đã claim() (status không còn 'pending' nữa nên findPendingBy... không tìm ra).
export class FindCheckpointByIdRequestDto {
  id: string;
}

// Giai đoạn 3 (HITL) — atomic conditional update (WHERE id = ? AND status =
// 'pending'), KHÔNG phải find-rồi-update rời: chặn race 2 request
// approve/reject cùng lúc (double-click, nhiều tab) khiến tool nguy hiểm bị
// thực thi 2 lần.
export class ClaimCheckpointRequestDto {
  id: string;
  toStatus: OrchestrationCheckpointStatus;
  // accuracy_problem.md mục 1 — set khi resolve checkpoint 'clarification'
  // (user vừa chọn 1 candidate), cùng 1 lượt atomic update với claim status.
  selectedProvider?: string;
}

export class ClaimCheckpointResponseDto {
  claimed: boolean;
}

// Giai đoạn 4, Step 1 — atomic conditional update (WHERE execution_started_at
// IS NULL), tách riêng khỏi claim() (status): chặn processApprovalJob() thực
// thi tool THẬT (mcpClient.callTool()) lần 2 nếu job bị BullMQ redeliver
// (stalled), bất kể attempts:1 có chặn được redelivery hay không.
export class ClaimCheckpointExecutionRequestDto {
  id: string;
}

// Bug fix — dọn checkpoint status=APPROVED bị kẹt sau worker crash (không dùng
// được claim() vốn chỉ UPDATE WHERE status=PENDING).
export class MarkStalledAsRejectedRequestDto {
  id: string;
}
