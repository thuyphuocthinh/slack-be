import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { TaskBoardEntity } from './task_board.entity';

@Entity('task_board_members')
@Unique(['boardId', 'memberId'])
export class BoardMemberEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'board_id' })
  @Index()
  boardId: string;

  @Column({ name: 'member_id' })
  @Index()
  memberId: string; // Workspace Member ID

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
