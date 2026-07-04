import {
  OrchestrationCheckpointStatus,
  PendingToolCall,
} from '../entity/orchestration-checkpoint.entity';
import { SupervisorRoundDto } from './supervisor.dto';
import { ChatHistoryTurnDto } from './message-client.dto';

export class CreateCheckpointRequestDto {
  replyMessageId: string;
  userId: string;
  botUserId: string;
  channelId: string;
  workspaceId: string;
  channelType: string;
  originalPrompt: string;
  pendingTool: PendingToolCall;
  pendingTask: string;
  roundsSoFar: SupervisorRoundDto[];
  history: ChatHistoryTurnDto[];
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
  pendingTool: PendingToolCall;
  pendingTask: string;
  roundsSoFar: SupervisorRoundDto[];
  history: ChatHistoryTurnDto[];
  status: OrchestrationCheckpointStatus;
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
}

export class ClaimCheckpointResponseDto {
  claimed: boolean;
}
