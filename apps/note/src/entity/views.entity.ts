import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { ViewType } from '../types/views.types';

@Entity('views')
export class ViewsEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'page_id' })
  @Index()
  pageId: string;

  @Column({ name: 'type', enum: ViewType, type: 'enum' })
  type: ViewType;

  @Column({ name: 'name', nullable: true, length: 255 })
  name: string;

  @Column({ type: 'jsonb', name: 'config' })
  config: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt: Date;
}
