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

  @Column({ type: 'uuid', name: 'channel_id' })
  channelId: string;

  @Column({ type: 'uuid', name: 'workspace_id' })
  workspaceId: string;

  // 'direct' | 'group' — ReactLoopService cần để emit đúng room khi resume
  // (Step 5); AgentStreamService phân biệt DIRECT/GROUP theo field này.
  @Column({ type: 'varchar', name: 'channel_type' })
  channelType: string;

  // Câu hỏi gốc user hỏi (KHÁC pendingTask — đây là toàn bộ turn, pendingTask
  // chỉ là phần việc của riêng agent đang bị chặn) — cần để gọi lại
  // SupervisorService.synthesize() tổng hợp câu trả lời cuối đúng ngữ cảnh
  // khi resume (Step 5), tái dùng nguyên cơ chế đã có từ Giai đoạn 2.
  @Column({ type: 'text', name: 'original_prompt' })
  originalPrompt: string;

  // Tool đang bị Risk Gate chặn — cần lưu đúng {provider, name, args} để
  // Approve chạy lại ĐÚNG tool này, không phải đoán lại.
  @Column({ type: 'jsonb', name: 'pending_tool' })
  pendingTool: PendingToolCall;

  // Task (prompt) Supervisor đã giao cho ReactLoop đang xử lý dở khi bị chặn
  // — Step 5 resume KHÔNG serialize lại được state hội thoại nội bộ của
  // LlmChatSession (opaque, provider-specific), nên resume = chạy 1 ReactLoop
  // MỚI cho agent đó, cần lại đúng task gốc này để biết đang làm dở việc gì.
  @Column({ type: 'text', name: 'pending_task' })
  pendingTask: string;

  // Kết quả các vòng delegate ĐÃ xong trước khi bị chặn — thiếu cái này thì
  // Supervisor "quên sạch" mọi thứ đã làm khi resume.
  @Column({ type: 'jsonb', name: 'rounds_so_far', default: () => "'[]'" })
  roundsSoFar: SupervisorRoundDto[];

  // Snapshot lịch sử hội thoại tại thời điểm dừng — dựng lại đúng
  // LlmChatSession khi resume (Step 5) thay vì hỏi lại từ đầu.
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
