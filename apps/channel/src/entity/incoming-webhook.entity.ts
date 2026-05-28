import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ChannelEntity } from './channel.entity';

@Entity('incoming_webhooks')
@Index(['channelId'])
@Index(['workspaceId'])
export class IncomingWebhookEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid', name: 'channel_id' })
  channelId: string;

  @Column({ nullable: false, type: 'uuid', name: 'workspace_id' })
  workspaceId: string;

  @Column({ nullable: false, type: 'uuid', name: 'created_by' })
  createdBy: string;

  @Column({
    nullable: false,
    type: 'varchar',
    name: 'name',
    default: 'Incoming Webhook',
    length: 128,
  })
  name: string;

  @Column({ nullable: true, type: 'varchar', name: 'description', length: 255 })
  description: string;

  @Column({ nullable: true, type: 'varchar', name: 'avatar_url', length: 500 })
  avatarUrl: string;

  @Column({ nullable: false, type: 'varchar', name: 'token' })
  @Index({ unique: true })
  token: string;

  @ManyToOne(() => ChannelEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel: ChannelEntity;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
