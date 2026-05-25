import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('huddle_participants')
export class HuddleParticipantEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'huddle_id', type: 'uuid' })
  @Index()
  huddleId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId: string;

  @CreateDateColumn({
    name: 'joined_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  joinedAt: Date;

  @Column({ name: 'left_at', type: 'timestamp', nullable: true })
  leftAt?: Date | null;

  @Column({ name: 'is_muted', type: 'boolean', default: false })
  isMuted: boolean;

  @Column({ name: 'is_screen_sharing', type: 'boolean', default: false })
  isScreenSharing: boolean;
}
