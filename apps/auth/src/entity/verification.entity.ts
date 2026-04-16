import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum VerificationAction {
  VERIFY_EMAIL = 'verify_email',
  RESET_PASSWORD = 'reset_password',
}

@Entity('verifications')
@Index('IDX_VERIFICATION_VERIFY', [
  'userId',
  'code',
  'action',
  'isUsed',
  'expiresAt',
])
@Index('IDX_VERIFICATION_USER_ACTION', ['userId', 'action'])
export class VerificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_verification_user')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  code: string;

  @Column({ type: 'boolean', default: false, name: 'is_used' })
  isUsed: boolean;

  @Column({ type: 'enum', enum: VerificationAction })
  action: VerificationAction;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
