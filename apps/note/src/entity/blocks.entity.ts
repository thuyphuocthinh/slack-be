import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { BlockType } from '../types/blocks.types';

@Entity('blocks')
export class BlocksEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'page_id' })
  @Index()
  pageId: string;

  @Column({ name: 'type', enum: BlockType, type: 'enum' })
  type: BlockType;

  @Column({ name: 'content', type: 'jsonb' })
  content: Record<string, unknown>;

  // Text phẳng trích từ `content` (xem utils/prosemirror.util.ts), maintain ở
  // tầng app mỗi lần content đổi — dùng để full-text search (content JSONB lồng
  // sâu, không to_tsvector trực tiếp được).
  @Column({ name: 'content_text', type: 'text', nullable: true })
  contentText: string | null;

  @Column({ name: 'order' })
  order: number;

  @Column({ name: 'parent_id', nullable: true })
  @Index()
  parentId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt: Date;
}
