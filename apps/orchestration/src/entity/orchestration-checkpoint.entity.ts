import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DelegationDto, SupervisorRoundDto } from '../dto/supervisor.dto';
import { ChatHistoryTurnDto } from '../dto/message-client.dto';
import { ECheckpointKind } from '@slack/constants';

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

  @Column({ type: 'varchar', default: ECheckpointKind.APPROVAL })
  kind: ECheckpointKind;

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

  // accuracy_problem.md mục 9.2 — các bước CÒN LẠI CHƯA CHẠY của kế hoạch gốc
  // tại thời điểm dừng (VD kế hoạch [A(cần duyệt/mơ hồ), B, C] → lưu [B, C] ở
  // đây). Cho phép resume ĐÚNG theo kế hoạch gốc (continueRounds() bỏ qua
  // plan(), dùng lại mảng này) thay vì buộc phải lập lại kế hoạch từ đầu,
  // không có gì đảm bảo bản mới không bỏ sót B/C. Dùng cho CẢ 2 loại
  // checkpoint ('approval' lẫn 'clarification'). Rỗng cho checkpoint tạo
  // trước migration này (coi như không có gì để resume thêm, giữ đúng hành vi
  // cũ).
  @Column({ type: 'jsonb', name: 'remaining_steps', default: () => "'[]'" })
  remainingSteps: DelegationDto[];

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

  // Set NGAY SAU KHI mcpClient.callTool() thật sự chạy xong thành công —
  // khác executionStartedAt (set TRƯỚC khi gọi). Phân biệt "worker crash
  // trước khi tool chạy" (null) với "tool đã chạy xong, crash lúc tổng hợp
  // câu trả lời" (có giá trị) — CheckpointCleanupService cần biết để không
  // bảo user "thử lại" 1 hành động ghi đã thực thi thành công rồi.
  @Column({ type: 'timestamptz', name: 'tool_executed_at', nullable: true })
  toolExecutedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
