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
  @Column({ type: 'jsonb', name: 'pending_tool' })
  pendingTool: PendingToolCall;

  @Column({ type: 'text', name: 'pending_task' })
  pendingTask: string;

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

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
