import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('leave_balances')
@Unique('IDX_UNIQUE_LEAVE_BALANCE', ['userId', 'workspaceId', 'year'])
export class LeaveBalanceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  @Index()
  workspaceId: string;

  @Column()
  year: number; // Năm áp dụng (ví dụ: 2026)

  @Column({ name: 'total_paid_leave', type: 'float', default: 12 })
  totalPaidLeave: number; // Tổng số ngày phép năm được cấp

  @Column({ name: 'used_paid_leave', type: 'float', default: 0 })
  usedPaidLeave: number; // Số ngày phép có lương đã sử dụng

  @Column({ name: 'used_sick_leave', type: 'float', default: 0 })
  usedSickLeave: number; // Số ngày nghỉ ốm đã sử dụng

  @Column({ name: 'used_unpaid_leave', type: 'float', default: 0 })
  usedUnpaidLeave: number; // Số ngày nghỉ không lương đã sử dụng

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
