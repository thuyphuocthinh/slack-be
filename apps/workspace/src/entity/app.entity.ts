import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum AppStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Entity('apps')
export class AppEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  @Index()
  workspaceId: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 255, nullable: true })
  description: string;

  @Column({ name: 'avatar_url', length: 512, nullable: true })
  avatarUrl: string;

  @Column({ name: 'request_url', length: 512, nullable: true })
  requestUrl: string;

  @Column({ name: 'signing_secret', length: 128, nullable: true })
  signingSecret: string;

  @Column({ name: 'bot_token', length: 128, nullable: true })
  botToken: string;

  @Column({
    type: 'enum',
    enum: AppStatus,
    default: AppStatus.ACTIVE,
  })
  status: AppStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
