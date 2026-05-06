import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  Index,
} from 'typeorm';

@Entity('channel_members')
@Unique(['channelId', 'memberId'])
export class ChannelMemberEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'channel_id', type: 'uuid' })
  @Index()
  channelId: string;

  @Column({ name: 'member_id', type: 'uuid' })
  @Index()
  memberId: string;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @Column({
    name: 'last_read_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  lastReadAt: Date;

  @Column({ name: 'last_read_message_id', type: 'uuid', nullable: true })
  lastReadMessageId: string | null;

  @Column({ name: 'unread_count', type: 'int', default: 0 })
  unreadCount: number;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
