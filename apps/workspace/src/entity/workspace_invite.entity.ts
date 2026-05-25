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
import { InviteStatus, WorkspaceRoleEnum } from '../types/workspace.enum';
import { WorkspaceEntity } from './workspace.entity';

@Entity('workspace_invites')
export class WorkspaceInviteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  @Index()
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: WorkspaceEntity;

  @Column({ length: 255 })
  @Index()
  email: string;

  @Column({
    type: 'enum',
    enum: WorkspaceRoleEnum,
  })
  role: WorkspaceRoleEnum;

  @Column({ name: 'token_hash', length: 255 })
  tokenHash: string;

  @Column({
    type: 'enum',
    enum: InviteStatus,
    default: InviteStatus.PENDING,
  })
  status: InviteStatus;

  @Column({ name: 'invited_by', type: 'uuid' })
  invitedBy: string;

  @Column({ name: 'expires_at' })
  expiresAt: Date;

  @Column({ name: 'accepted_at', nullable: true })
  acceptedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
