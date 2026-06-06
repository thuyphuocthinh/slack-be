import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('canvases')
export class CanvasEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid', nullable: true })
  channelId: string; // 1 Channel chỉ có 1 Canvas mặc định

  @Column({ type: 'bytea', nullable: true })
  contentState: Buffer; // Lưu state nhị phân của Yjs

  @Column({ type: 'jsonb', nullable: true })
  contentJson: Record<string, unknown>; // Bản snapshot JSON cho mục đích Search/Index

  @Column({ type: 'uuid' })
  updatedBy: string; // User ID người sửa cuối cùng

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
