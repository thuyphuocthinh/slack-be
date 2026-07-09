import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export interface DynamicProviderAuthConfig {
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  authorizationUrl?: string;
  scope?: string;
  [key: string]: unknown;
}

export enum EDynamicProviderAuthType {
  NONE = 'NONE',
  API_KEY = 'API_KEY',
  BEARER = 'BEARER',
  BASIC = 'BASIC',
  OAUTH2 = 'OAUTH2',
}

@Entity('orchestration_dynamic_providers')
export class DynamicProviderEntity {
  @PrimaryColumn()
  id: string; // custom_uuid

  @Index('idx_dyn_prov_user_id')
  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  name: string;

  @Column({ name: 'spec_url', type: 'text' })
  specUrl: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  /**
   * Đóng vai trò là "Chìa khoá chính" (Primary Secret).
   * - Nếu authType = API_KEY -> Chứa API Key tĩnh.
   * - Nếu authType = BASIC -> Chứa Username/Password (hoặc base64).
   * - Nếu authType = BEARER -> Chứa Bearer Token (VD: JWT).
   * - Nếu authType = OAUTH2 -> Chứa Access Token ngắn hạn (được tự động làm mới).
   */
  @Column({ name: 'access_token', nullable: true })
  accessToken?: string;

  @Column({ name: 'auth_type', type: 'varchar', length: 50, default: EDynamicProviderAuthType.BEARER })
  authType: EDynamicProviderAuthType;

  @Column({ name: 'refresh_token', type: 'text', nullable: true })
  refreshToken?: string;

  @Column({ name: 'token_expires_at', type: 'timestamptz', nullable: true })
  tokenExpiresAt?: Date;

  @Column({ name: 'auth_config', type: 'jsonb', nullable: true })
  authConfig?: DynamicProviderAuthConfig;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
