import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('two_factor')
@Index('IDX_TWO_FACTOR_USER_ID', ['userId'], { unique: true })
export class TwoFactorEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, name: 'user_id' })
  userId: string;

  @Column({ nullable: false, name: 'secret' })
  secret: string;

  @Column({ nullable: false, name: 'enabled' })
  enabled: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
