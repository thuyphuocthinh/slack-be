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
  ManyToMany,
  JoinTable,
  OneToMany,
} from 'typeorm';
import { ChecklistEntity } from './checklist.entity';
import { TaskGroupEntity } from './task_group.entity';
import { LabelEntity } from './label.entity';
import { TaskAttachmentEntity } from './task_attachment.entity';
import { TaskMemberEntity } from './task_member.entity';

@Entity('tasks')
export class TaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'group_id' })
  @Index()
  groupId: string;

  @Column({ name: 'title' })
  title: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string;

  @Column({ name: 'start_date', nullable: true })
  startDate: Date;

  @Column({ name: 'due_date', nullable: true })
  dueDate: Date;

  @Column({ name: 'order', default: 0 })
  order: number;

  @ManyToOne(() => TaskGroupEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group: TaskGroupEntity;

  @ManyToMany(() => LabelEntity)
  @JoinTable({ name: 'task_label_mapping' })
  labels: LabelEntity[];

  @OneToMany(() => ChecklistEntity, (checklist) => checklist.task)
  checklists: ChecklistEntity[];

  @OneToMany(() => TaskAttachmentEntity, (attachment) => attachment.task)
  attachments: TaskAttachmentEntity[];

  @OneToMany(() => TaskMemberEntity, (member) => member.task)
  members: TaskMemberEntity[];

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
