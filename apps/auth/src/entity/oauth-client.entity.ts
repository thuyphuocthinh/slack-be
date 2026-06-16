import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { OAuthScope } from '@slack/constants';

@Entity('oauth_clients')
@Index('IDX_OAUTH_CLIENTS_OWNER', ['ownerId'])
export class OAuthClientEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'owner_id' })
  ownerId: string;

  @Column({ type: 'varchar', length: 100, name: 'name' })
  name: string;

  @Column({ type: 'varchar', length: 512, nullable: true, name: 'logo_url' })
  logoUrl: string | null;

  @Column({ type: 'varchar', length: 100, unique: true, name: 'client_id' })
  clientId: string;

  @Column({ type: 'varchar', length: 255, name: 'client_secret' })
  clientSecret: string;

  @Column({ type: 'text', array: true, name: 'redirect_uris' })
  redirectUris: string[];

  @Column({ type: 'varchar', array: true, default: [OAuthScope.OPENID, OAuthScope.PROFILE, OAuthScope.EMAIL], name: 'allowed_scopes' })
  allowedScopes: OAuthScope[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
