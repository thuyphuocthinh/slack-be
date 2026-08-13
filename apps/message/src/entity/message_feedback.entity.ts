import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { MessageEntity } from './message.entity';

// Khác MessageReactionEntity (unique theo messageId+userId+emoji, cho phép
// nhiều emoji/user vì là cảm xúc xã hội) — feedback là tín hiệu ĐÚNG/SAI DUY
// NHẤT cho câu trả lời AI, nên unique CHỈ theo (messageId, userId): 1 user chỉ
// có đúng 1 trạng thái/message, vote sau đè vote trước thay vì cộng dồn.
@Entity('message_feedback')
@Unique(['messageId', 'userId'])
export class MessageFeedbackEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid', name: 'message_id' })
  messageId: string;

  @ManyToOne(() => MessageEntity, (message) => message.feedback, {
    onDelete: 'CASCADE',
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'message_id', referencedColumnName: 'id' })
  message: MessageEntity;

  @Column({ nullable: false, type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ nullable: false, type: 'varchar', name: 'type' })
  type: 'like' | 'unlike';

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
