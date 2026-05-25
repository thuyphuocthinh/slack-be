import { SystemRoleEnum } from '@slack/constants';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING = 'pending',
}

@Entity('users')
@Index('IDX_USERS_EMAIL', ['email'], { unique: true })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, length: 255, unique: true })
  email: string;

  @Column({ nullable: true, length: 100, unique: false, name: 'first_name' })
  firstName: string;

  @Column({ nullable: true, length: 100, unique: false, name: 'last_name' })
  lastName: string;

  @Column({ nullable: true, length: 512, name: 'avatar_url' })
  avatarUrl: string;

  @Column({
    nullable: false,
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.PENDING,
  })
  status: UserStatus;

  @Column({
    name: 'system_role',
    type: 'enum',
    enum: SystemRoleEnum,
    default: SystemRoleEnum.USER,
  })
  systemRole: SystemRoleEnum;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @VersionColumn({ nullable: false, default: 1, name: 'version' })
  version: number;
}
