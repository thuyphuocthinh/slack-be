import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export interface DynamicProviderAuthConfig {
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  authorizationUrl?: string;
  scope?: string;
  /** Most OAuth2 token endpoints accept form-urlencoded (the default); some (e.g. Atlassian's
   *  auth.atlassian.com, used by Jira/Confluence) require JSON instead. Resolved once at
   *  registration time (auto-detected from tokenUrl, or explicitly overridden) and reused as-is
   *  by the reactive renew on a 401 — never re-inferred later. */
  refreshRequestFormat?: 'form' | 'json';
  /** Escape hatch for refresh_token response shapes the built-in auto-detection (snake_case,
   *  camelCase, 1-level "data"/"result" envelope) can't cover — dot-path into the response
   *  (e.g. "payload.token.accessToken"). Only needed for fully custom internal auth endpoints. */
  responseAccessTokenPath?: string;
  responseRefreshTokenPath?: string;
  responseExpiresInPath?: string;
  /** Used only when no expiry field is found anywhere in the refresh response. Defaults to 3600
   *  (1 hour) — many hand-rolled internal auth endpoints don't return a TTL at all. */
  defaultExpiresInSecs?: number;
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

  @Column({
    name: 'auth_type',
    type: 'varchar',
    length: 50,
    default: EDynamicProviderAuthType.BEARER,
  })
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
