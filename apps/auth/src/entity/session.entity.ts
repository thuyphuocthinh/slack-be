import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('sessions')
@Index('IDX_SESSION_REFRESH_TOKEN', ['refreshToken'], { unique: true })
@Index('IDX_SESSION_REFRESH_TOKEN_REVOKED', ['refreshToken', 'isRevoked'])
@Index('IDX_SESSION_USER_ID_REVOKED', ['userId', 'isRevoked'])
export class SessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 512, name: 'refresh_token' })
  refreshToken: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  device: string;

  @Column({ type: 'varchar', length: 45, nullable: true, name: 'ip_address' })
  ipAddress: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'user_agent' })
  userAgent: string;

  @Column({ type: 'boolean', default: false, name: 'is_revoked' })
  isRevoked: boolean;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updated_at: Date;
}
