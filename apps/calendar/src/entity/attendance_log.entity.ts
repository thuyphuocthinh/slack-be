import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { AttendanceLogType } from '../types/calendar.enum';

@Entity('attendance_logs')
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
