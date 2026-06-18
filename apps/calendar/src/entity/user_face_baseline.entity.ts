import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('user_face_baselines')
@Unique('IDX_UNIQUE_FACE_BASELINE', ['userId', 'workspaceId'])
export class UserFaceBaselineEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  @Index()
  workspaceId: string;

  @Column({ name: 'face_baseline_key', type: 'text' })
  faceBaselineKey: string; // Key ảnh chân dung mẫu lưu trên S3

  @Column({ name: 'face_descriptor', type: 'jsonb', nullable: true })
  faceDescriptor: number[]; // Mảng 128 số thực trích xuất từ khuôn mặt phục vụ so khớp trực tiếp

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
