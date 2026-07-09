import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('orchestration_dynamic_providers')
export class DynamicProviderEntity {
  @PrimaryColumn()
  id: string; // custom_uuid

  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  name: string;

  @Column({ name: 'spec_url', type: 'text' })
  specUrl: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'api_key', nullable: true })
  apiKey?: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
