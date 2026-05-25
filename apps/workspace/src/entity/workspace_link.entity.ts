import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import {
  WorkspaceLinkStatus,
  WorkspaceLinkType,
} from '../types/workspace.enum';
import { WorkspaceEntity } from './workspace.entity';

@Entity('workspace_links')
export class WorkspaceLinkEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  @Index()
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: WorkspaceEntity;

  @Column({
    type: 'enum',
    enum: WorkspaceLinkType,
    default: WorkspaceLinkType.PUBLIC_INVITE,
  })
  type: WorkspaceLinkType;

  @Column({ name: 'token_hash', length: 255 })
  tokenHash: string;

  @Column({
    type: 'enum',
    enum: WorkspaceLinkStatus,
    default: WorkspaceLinkStatus.ACTIVE,
  })
  status: WorkspaceLinkStatus;

  @Column({ name: 'max_usage', nullable: true })
  maxUsage: number;

  @Column({ name: 'used_count', default: 0 })
  usedCount: number;

  @Column({ name: 'expires_at', nullable: true })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
