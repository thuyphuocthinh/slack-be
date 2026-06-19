import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { ShiftType, ShiftLocation, ShiftStatus } from '../types/calendar.enum';

@Entity('work_shifts')
@Unique('IDX_UNIQUE_SHIFT_PER_DAY', ['userId', 'workspaceId', 'workDate'])
export class WorkShiftEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  @Index()
  workspaceId: string;

  @Column({ name: 'work_date', type: 'date' })
  @Index()
  workDate: string; // YYYY-MM-DD — ngày làm việc cụ thể

  @Column({
    name: 'shift_type',
    type: 'enum',
    enum: ShiftType,
    default: ShiftType.FULLTIME,
  })
  shiftType: ShiftType;

  @Column({
    type: 'enum',
    enum: ShiftLocation,
    default: ShiftLocation.OFFICE,
  })
  location: ShiftLocation;

  @Column({ name: 'start_time', type: 'timestamptz' })
  startTime: Date;

  @Column({ name: 'end_time', type: 'timestamptz' })
  endTime: Date;

  @Column({
    type: 'enum',
    enum: ShiftStatus,
    default: ShiftStatus.APPROVED,
  })
  status: ShiftStatus;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
