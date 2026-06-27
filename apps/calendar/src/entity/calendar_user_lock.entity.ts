import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('calendar_user_locks')
@Index('IDX_USER_LOCK', ['userId', 'workspaceId', 'targetMonth'], { unique: true })
// Partial-style index phục vụ cleanupExpiredLocks cron (LessThan query trên unlockExpiresAt)
@Index('IDX_LOCK_EXPIRES_AT', ['unlockExpiresAt'])
export class CalendarUserLockEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'target_month', type: 'varchar', length: 7 })
  targetMonth: string; // YYYY-MM

  @Column({ name: 'is_unlocked', type: 'boolean', default: false })
  isUnlocked: boolean;

  @Column({ name: 'unlocked_by', type: 'uuid', nullable: true })
  unlockedBy: string;

  @Column({ name: 'unlock_reason', type: 'text', nullable: true })
  unlockReason: string;

  @Column({ name: 'unlock_expires_at', type: 'timestamptz', nullable: true })
  unlockExpiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
