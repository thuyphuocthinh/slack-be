import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Giai đoạn 4, Step 1 — chặn PROCESS_AI_TRIGGER chạy lại (BullMQ retry/stalled)
// tạo thêm message "Đang xử lý..." trùng cho cùng 1 message gốc. Unique trên
// triggerMessageId + insert-once (ON CONFLICT DO NOTHING) đóng vai trò "claim"
// atomic, cùng kỹ thuật với CheckpointService.claim().
@Entity('orchestration_trigger_claims')
export class OrchestrationTriggerClaimEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'trigger_message_id', unique: true })
  triggerMessageId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
