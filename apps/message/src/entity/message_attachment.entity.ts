import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { MessageEntity } from './message.entity';
import { v7 as uuidv7 } from 'uuid';

@Entity('message_attachments')
export class MessageAttachmentEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = uuidv7();

  @Column({ type: 'uuid', name: 'message_id' })
  @Index()
  messageId: string;

  @Column({ type: 'uuid', name: 'resource_id' })
  @Index()
  resourceId: string;

  @Column({ name: 'public_id' })
  publicId: string;

  @Column()
  url: string;

  @Column()
  filename: string;

  @Column({ name: 'mime_type' })
  mimeType: string;

  @Column()
  size: number;

  @Column()
  type: string;

  @Column({ name: 'thumbnail_url', nullable: true })
  thumbnailUrl?: string;

  @ManyToOne(() => MessageEntity, (message) => message.attachments, {
    onDelete: 'CASCADE',
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'message_id', referencedColumnName: 'id' })
  message: MessageEntity;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
