import {
  OrchestrationCheckpointStatus,
  PendingToolCall,
} from '../entity/orchestration-checkpoint.entity';
import { SupervisorRoundDto } from './supervisor.dto';
import { ChatHistoryTurnDto } from './message-client.dto';

export class CreateCheckpointRequestDto {
  replyMessageId: string;
  userId: string;
  channelId: string;
  workspaceId: string;
  channelType: string;
  originalPrompt: string;
  pendingTool: PendingToolCall;
  pendingTask: string;
  roundsSoFar: SupervisorRoundDto[];
  history: ChatHistoryTurnDto[];
}

export class FindPendingCheckpointRequestDto {
  replyMessageId: string;
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
