import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { IntegrationProvider, IntegrationTargetType, IntegrationStatus } from '@slack/constants';

@Entity('user_integrations')
@Index(['userId', 'provider', 'providerAccountId'], { unique: true })
export class UserIntegrationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  @Index()
  userId: string;

  @Column('uuid', { name: 'workspace_id', nullable: true })
  @Index()
  workspaceId: string | null;

  @Column({
    type: 'enum',
    enum: IntegrationTargetType,
    name: 'target_type',
    default: IntegrationTargetType.USER,
  })
  targetType: IntegrationTargetType;

  @Column({
    type: 'enum',
    enum: IntegrationProvider,
  })
  provider: IntegrationProvider;

  @Column({ name: 'provider_account_id', type: 'varchar', nullable: true })
  providerAccountId: string | null;

  @Column({ name: 'access_token', type: 'text' })
  accessToken: string;

  @Column({ name: 'refresh_token', type: 'text', nullable: true })
  refreshToken: string;

  @Column({ name: 'token_expiry', type: 'timestamptz', nullable: true })
  tokenExpiry: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @Column({ type: 'jsonb', nullable: true })
  scopes: string[];

  @Column({
    type: 'enum',
    enum: IntegrationStatus,
    default: IntegrationStatus.CONNECTED,
  })
  status: IntegrationStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
