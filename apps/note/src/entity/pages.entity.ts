import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { PageType } from '../types/pages.types';

@Entity('pages')
export class PagesEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  @Index()
  userId: string;

  @Column({ name: 'workspace_id' })
  @Index()
  workspaceId: string;

  @Column({ name: 'parent_id', nullable: true })
  @Index()
  parentId: string;

  @Column({ nullable: true, length: 255 })
  title: string;

  @Column({ name: 'favicon', nullable: true, length: 255 })
  favicon: string;

  @Column({ name: 'cover_image', nullable: true, length: 512 })
  coverImage: string;

  @Column({
    type: 'enum',
    name: 'type',
    default: PageType.Normal,
    enum: PageType,
  })
  type: PageType;

  @Column({ name: 'path' })
  path: string;

  @Column({ name: 'depth', default: 0 })
  depth: number;

  @Column({ name: 'is_public', default: false })
  isPublic: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt: Date;
}
