import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AttendanceLogType } from '../types/calendar.enum';
import { WorkShiftEntity } from './work_shift.entity';

@Entity('attendance_logs')
@Index('idx_attendance_logs_recent', ['workspaceId', 'userId', 'logType', 'recordedAt'])
export class AttendanceLogEntity {
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
  workShiftId: string; // FK tới work_shifts — biết log này thuộc ca nào

  @ManyToOne(() => WorkShiftEntity, shift => shift.attendanceLogs)
  @JoinColumn({ name: 'work_shift_id' })
  workShift: WorkShiftEntity;

  @Column({
    name: 'log_type',
    type: 'enum',
    enum: AttendanceLogType,
  })
  logType: AttendanceLogType;

  @Column({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt: Date;

  @Column({ name: 'ip_address', type: 'varchar', nullable: true })
  ipAddress: string;

  @Column({ name: 'face_image_key', type: 'text', nullable: true })
  faceImageKey: string; // S3 key ảnh chụp webcam lúc bấm nút (dành cho WFH)

  @Column({ name: 'face_similarity_score', type: 'float', nullable: true })
  faceSimilarityScore: number; // Điểm AI so khớp khuôn mặt (0.0 - 1.0)

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
