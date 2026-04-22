import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import {
  NotificationType,
  NotificationStatus,
} from '../types/notification.type';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'recipient_id' })
  recipientId: string;

  @Column({ name: 'template_key' })
  templateKey: string;

  @Column({ nullable: true, length: 255 })
  content: string;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column({
    type: 'enum',
    enum: NotificationStatus,
    default: NotificationStatus.UNREAD,
  })
  status: NotificationStatus;

  @Column({ name: 'object_id' })
  objectId: string;

  @Column({ name: 'object_type' })
  objectType: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ name: 'created_at', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ name: 'updated_at', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}

/**
 * 
 * Business action xảy ra
    ↓
    1. Update DB (state)
    2. Publish domain event
    3. Ghi audit log         (side effect)
    4. Gửi notification      (side effect)
    5. Emit socket           (side effect)
    Viết dto, services interface ra, kêu AI implement kkk
 */
