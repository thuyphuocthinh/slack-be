import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { DailyReconciliationStatus } from '../types/calendar.enum';

@Entity('daily_reconciliations')
@Unique('IDX_UNIQUE_RECONCILIATION_PER_DAY', ['userId', 'workspaceId', 'workDate'])
export class DailyReconciliationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  @Index()
  workspaceId: string;

  @Column({ name: 'work_shift_id', type: 'uuid', nullable: true })
  @Index()
  workShiftId: string; // FK tới work_shifts — liên kết ca đăng ký gốc

  @Column({ name: 'work_date', type: 'date' })
  @Index()
  workDate: string; // YYYY-MM-DD

  @Column({ name: 'first_check_in', type: 'timestamptz', nullable: true })
  firstCheckIn: Date; // Lần check-in đầu tiên trong ngày (tính từ attendance_logs)

  @Column({ name: 'last_check_out', type: 'timestamptz', nullable: true })
  lastCheckOut: Date; // Lần check-out cuối cùng trong ngày

  @Column({ name: 'actual_work_hours', type: 'float', default: 0.0 })
  actualWorkHours: number; // Số giờ làm việc thực tế (Cron Job tính toán)

  @Column({ name: 'standard_work_hours', type: 'float', default: 0.0 })
  standardWorkHours: number; // Số giờ tiêu chuẩn copy từ ca (FULLTIME=8, PARTTIME=4)

  @Column({ name: 'late_minutes', type: 'int', default: 0 })
  lateMinutes: number; // Số phút đi muộn so với startTime của ca

  @Column({ name: 'early_leave_minutes', type: 'int', default: 0 })
  earlyLeaveMinutes: number; // Số phút về sớm so với endTime của ca

  @Column({
    type: 'enum',
    enum: DailyReconciliationStatus,
    default: DailyReconciliationStatus.ABSENT,
  })
  status: DailyReconciliationStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
