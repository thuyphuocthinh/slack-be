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
