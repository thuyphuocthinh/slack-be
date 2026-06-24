import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CalendarSyncStatus } from '@slack/constants';
import { UserIntegrationEntity } from '../../auth/entity/user-integration.entity';

@Entity('calendar_sync_mappings')
@Index(['integrationId', 'shiftId'], { unique: true })
export class CalendarSyncMappingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'integration_id' })
  @Index()
  integrationId: string;

  @ManyToOne(() => UserIntegrationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'integration_id' })
  integration: UserIntegrationEntity;

  @Column('uuid', { name: 'shift_id' })
  @Index()
  shiftId: string;

  @Column({ name: 'external_event_id', type: 'varchar', nullable: true })
  externalEventId: string | null;

  @Column({
    type: 'enum',
    enum: CalendarSyncStatus,
    name: 'sync_status',
    default: CalendarSyncStatus.PENDING,
  })
  syncStatus: CalendarSyncStatus;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
