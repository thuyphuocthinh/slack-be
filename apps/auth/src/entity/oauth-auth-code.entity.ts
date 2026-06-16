import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  Index,
} from 'typeorm';
import { OAuthScope } from '@slack/constants';

@Entity('oauth_auth_codes')
@Index('IDX_OAUTH_AUTH_CODES_USER_ID', ['userId'])
@Index('IDX_OAUTH_AUTH_CODES_CLIENT_ID', ['clientId'])
export class OAuthAuthCodeEntity {
  @PrimaryColumn({ type: 'varchar', length: 100, name: 'code' })
  code: string;

  @Column({ type: 'varchar', length: 100, name: 'client_id' })
  clientId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 512, name: 'redirect_uri' })
  redirectUri: string;

  @Column({ type: 'varchar', array: true, name: 'scopes' })
  scopes: OAuthScope[];

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
