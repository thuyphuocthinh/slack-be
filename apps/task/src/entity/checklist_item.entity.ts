import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ChecklistEntity } from './checklist.entity';

@Entity('task_checklist_items')
export class ChecklistItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'checklist_id' })
  @Index()
  checklistId: string;

  @Column({ name: 'content' })
  content: string;

  @Column({ name: 'is_completed', default: false })
  isCompleted: boolean;

  @ManyToOne(() => ChecklistEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'checklist_id' })
  checklist: ChecklistEntity;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @VersionColumn({ nullable: false, default: 1, name: 'version' })
  version: number;
}
