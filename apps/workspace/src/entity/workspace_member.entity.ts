import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { WorkspaceRoleEnum, MembershipStatus } from '../types/workspace.enum';

@Entity('workspace_members')
@Unique(['workspaceId', 'userId'])
export class WorkspaceMemberEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  @Index()
  workspaceId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId: string;

  @Column({
    type: 'enum',
    enum: WorkspaceRoleEnum,
  })
  role: WorkspaceRoleEnum;

  @Column({
    type: 'enum',
    enum: MembershipStatus,
    default: MembershipStatus.ACTIVE,
  })
  status: MembershipStatus;

  @Column({ name: 'joined_at', default: () => 'CURRENT_TIMESTAMP' })
  joinedAt: Date;

  @Column({ name: 'removed_at', nullable: true })
  removedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
