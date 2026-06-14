import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { WorkspaceEntity } from './workspace.entity';

@Entity('workspace_sso_configs')
export class WorkspaceSsoConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'workspace_id', type: 'uuid', unique: true })
  workspaceId: string;

  @OneToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: WorkspaceEntity;

  @Column({ length: 100, unique: true })
  domain: string; // e.g. 'acme.com'

  @Column({ name: 'provider_type', type: 'varchar', length: 10 })
  providerType: 'SAML2' | 'OIDC'; // 'SAML2' or 'OIDC'

  // SAML 2.0 configuration fields
  @Column({ name: 'entry_point', length: 512, nullable: true })
  entryPoint?: string;

  @Column({ name: 'idp_cert', type: 'text', nullable: true })
  idpCert?: string;

  @Column({ name: 'issuer', length: 255, nullable: true })
  issuer?: string;

  // OIDC configuration fields
  @Column({ name: 'client_id', length: 255, nullable: true })
  clientId?: string;

  @Column({ name: 'client_secret', length: 255, nullable: true })
  clientSecret?: string;

  @Column({ name: 'discovery_url', length: 512, nullable: true })
  discoveryUrl?: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
