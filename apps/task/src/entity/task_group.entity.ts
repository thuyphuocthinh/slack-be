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
import { TaskBoardEntity } from './task_board.entity';

@Entity('task_groups')
export class TaskGroupEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'board_id' })
  @Index()
  boardId: string;

  @Column({ name: 'name' })
  name: string;

  @Column({ name: 'order', default: 0 })
  order: number;

  @ManyToOne(() => TaskBoardEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'board_id' })
  board: TaskBoardEntity;

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
}
