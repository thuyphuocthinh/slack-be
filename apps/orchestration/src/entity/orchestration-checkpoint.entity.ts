import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SupervisorRoundDto } from '../dto/supervisor.dto';
import { ChatHistoryTurnDto } from '../dto/message-client.dto';

export enum OrchestrationCheckpointStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export interface PendingToolCall {
  provider: string;
  name: string;
  args: Record<string, unknown>;
}

// accuracy_problem.md mục 1 — 1 candidate agent trong cụm mơ hồ mà
// findAmbiguousAgentCluster() (supervisor.service.ts) phát hiện được.
export interface AmbiguousAgentCandidate {
  provider: string;
  label: string;
}

/**
 * Giai đoạn 3 (HITL) — state của 1 turn đang DỪNG chờ user duyệt 1 tool rủi ro
 * (`destructiveHint`). `resolveAnswer()` chạy 1 mạch trong RAM của job hiện
 * tại — turn có thể dừng nhiều phút/giờ tới khi user bấm Approve/Reject, có
 * thể trúng 1 instance orchestration KHÁC (scale ngang) — nên state phải nằm
 * ngoài process, đủ để dựng lại đúng ngữ cảnh khi resume (Step 5), không phải
 * chạy lại Supervisor từ đầu.
 */
@Entity('orchestration_checkpoints')
export class OrchestrationCheckpointEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Chính là message "approval_request" (Step 3) — FE chỉ có messageId khi
  // user bấm Approve/Reject, không có checkpoint id. unique: true đã tự tạo
  // index, không cần thêm @Index() riêng.
  @Column({ type: 'uuid', name: 'reply_message_id', unique: true })
  replyMessageId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  @Index()
  userId: string;

  // Người GỬI message "approval_request" (luôn là bot, KHÁC `userId` — người
  // TRIGGER/duyệt) — cần lưu lại vì `resolveApproval()` phải update ĐÚNG
  // message này bằng danh nghĩa người đã tạo ra nó (message service chặn
  // update nếu `userId` truyền vào khác `message.userId`/sender thật —
  // ERR.MESSAGE.0103). Nullable vì cột thêm sau, checkpoint tạo TRƯỚC migration
  // này sẽ không có giá trị (coi là dữ liệu cũ, không dùng lại được).
  @Column({ type: 'uuid', name: 'bot_user_id', nullable: true })
  botUserId: string;

  @Column({ type: 'uuid', name: 'channel_id' })
  channelId: string;

  @Column({ type: 'uuid', name: 'workspace_id' })
  workspaceId: string;

  @Column({ type: 'varchar', name: 'channel_type' })
  channelType: string;

  @Column({ type: 'text', name: 'original_prompt' })
  originalPrompt: string;

  // accuracy_problem.md mục 1 — nullable vì checkpoint 'clarification' KHÔNG
  // gắn với 1 tool call cụ thể nào (chưa biết agent nào đúng), khác hẳn
  // checkpoint 'approval' (luôn có đúng 1 pendingTool chờ duyệt).
  @Column({ type: 'jsonb', name: 'pending_tool', nullable: true })
  pendingTool: PendingToolCall | null;

  @Column({ type: 'text', name: 'pending_task' })
  pendingTask: string;

  // accuracy_problem.md mục 1 — 'approval' (hành vi cũ, mặc định — chờ duyệt
  // 1 tool destructiveHint) hay 'clarification' (chờ user chọn agent đúng khi
  // plan() mơ hồ giữa 2+ lựa chọn, xem findAmbiguousAgentCluster()). Checkpoint
  // cũ (tạo trước migration này) mặc định 'approval', vẫn đúng hành vi.
  @Column({ type: 'varchar', default: 'approval' })
  kind: 'approval' | 'clarification';

  @Column({ type: 'text', name: 'clarification_question', nullable: true })
  clarificationQuestion: string | null;

  @Column({
    type: 'jsonb',
    name: 'clarification_candidates',
    nullable: true,
  })
  clarificationCandidates: AmbiguousAgentCandidate[] | null;

  // Set khi user chọn xong 1 candidate (resolveApproval action='clarify') —
  // processApprovalJob() đọc lại field này để biết ép agent nào cho bước đang chờ.
  @Column({ type: 'varchar', name: 'selected_provider', nullable: true })
  selectedProvider: string | null;

  @Column({ type: 'jsonb', name: 'rounds_so_far', default: () => "'[]'" })
  roundsSoFar: SupervisorRoundDto[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  history: ChatHistoryTurnDto[];

  @Column({
    type: 'enum',
    enum: OrchestrationCheckpointStatus,
    default: OrchestrationCheckpointStatus.PENDING,
  })
  status: OrchestrationCheckpointStatus;

  // Quá hạn (mặc định 24h, xem ORCHESTRATION_CONSTANTS.CHECKPOINT_EXPIRY_MS)
  // mà chưa được duyệt/từ chối → CheckpointCleanupService tự reject (Step 8) —
  // tránh 1 checkpoint bị bỏ quên treo "pending" vĩnh viễn.
  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  // Giai đoạn 4, Step 1 — claim atomic riêng cho lần THỰC THI tool trong
  // processApprovalJob(), độc lập với "status" (status đã đổi 'approved' TRƯỚC
  // khi job này chạy, xem resolveApproval()). Null nghĩa là chưa thực thi lần nào.
  @Column({ type: 'timestamptz', name: 'execution_started_at', nullable: true })
  executionStartedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
