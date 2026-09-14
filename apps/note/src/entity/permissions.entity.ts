import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PermissionType } from '../types/permission.types';

@Entity('permissions')
@Index(['pageId', 'userId'], { unique: true })
export class PermissionsEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'page_id' })
  pageId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'type', enum: PermissionType, type: 'enum' })
  type: PermissionType;

  @Column({ type: 'timestamptz', name: 'created_at' })
  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  @UpdateDateColumn()
  updatedAt: Date;
}
