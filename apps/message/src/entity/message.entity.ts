import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MessageReactionEntity } from './message_reaction.entity';
import { MessageMentionEntity } from './message_mention.entity';

@Entity('messages')
export class MessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid', name: 'channel_id' })
  channelId: string;

  @Column({ nullable: false, type: 'uuid', name: 'user_id' })
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
  parentId: string;

  @ManyToOne(() => MessageEntity, (message) => message.replies, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parent_id' })
  parent: MessageEntity;

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
