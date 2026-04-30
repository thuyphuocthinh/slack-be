import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MessageReactionEntity } from './message_reaction.entity';
import { MessageMentionEntity } from './message_mention.entity';

// @Entity('messages')
export class MessageEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string; // uuid v7
  /**
   * UUID cho User và Channel. Dùng UUIDv7 cho Message sẽ giúp đồng bộ hoàn toàn kiểu dữ liệu. 
   * UUIDv7 vẫn đảm bảo sắp xếp theo thời gian (giúp query tin nhắn mới nhất rất nhanh).
   */

  @Column({ nullable: false, type: 'uuid', name: 'channel_id' })
  @Index()
  channelId: string;

  @Column({ nullable: false, type: 'uuid', name: 'user_id' })
  @Index()
  userId: string;

  @Column({ nullable: false, type: 'jsonb', name: 'content' })
  content: string;

  @Column({
    nullable: false,
    type: 'boolean',
    name: 'is_pinned',
    default: false,
  })
  isPinned: boolean;

  @Column({ nullable: true, type: 'uuid', name: 'parent_id' })
  @Index()
  parentId: string;

  @ManyToOne(() => MessageEntity, (message) => message.replies, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parent_id' })
  parent: MessageEntity;

  // self-join
  @OneToMany(() => MessageEntity, (message) => message.parent)
  replies: MessageEntity[];

  @OneToMany(() => MessageReactionEntity, (reaction) => reaction.message)
  reactions: MessageReactionEntity[];

  @OneToMany(() => MessageMentionEntity, (mention) => mention.message)
  mentions: MessageMentionEntity[];

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
