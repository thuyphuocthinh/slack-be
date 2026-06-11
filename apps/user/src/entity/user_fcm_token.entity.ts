import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_fcm_tokens')
@Index('IDX_USER_FCM_TOKENS_USER_DEVICE', ['userId', 'deviceId'], { unique: true })
export class UserFcmTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: false })
  userId: string;

  @Column({ name: 'device_id', type: 'varchar', length: 255, nullable: false })
  deviceId: string;

  @Column({ name: 'token', type: 'text', nullable: false })
  token: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
