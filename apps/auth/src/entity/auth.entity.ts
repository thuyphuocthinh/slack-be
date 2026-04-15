import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ProviderType {
  LOCAL = 'local',
  GOOGLE = 'google',
}

@Entity('auth')
export class AuthEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'enum', enum: ProviderType, name: 'provider_type' })
  providerType: ProviderType;

  @Column({ type: 'varchar', length: 255, name: 'provider_id' })
  providerId: string;

  @Column({ type: 'text', nullable: true })
  password: string;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
