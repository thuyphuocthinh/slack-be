import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  Index,
} from 'typeorm';

@Entity('oauth_tokens')
@Index('IDX_OAUTH_TOKENS_USER_ID', ['userId'])
@Index('IDX_OAUTH_TOKENS_CLIENT_ID', ['clientId'])
@Index('IDX_OAUTH_TOKENS_USER_CLIENT_ID', ['userId', 'clientId'])
export class OAuthTokenEntity {
  @PrimaryColumn({ type: 'text', name: 'access_token' })
  accessToken: string;

  @Column({ type: 'varchar', length: 255, unique: true, name: 'refresh_token' })
  refreshToken: string;

  @Column({ type: 'varchar', length: 100, name: 'client_id' })
  clientId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
