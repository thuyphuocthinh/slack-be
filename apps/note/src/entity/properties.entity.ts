import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { PropertyType } from '../types/properties.types';

@Entity('properties')
export class PropertiesEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'page_id' })
  @Index()
  pageId: string;

  @Column({ name: 'name', nullable: true, length: 255 })
  name: string;

  @Column({ name: 'order' })
  order: number;

  @Column({ name: 'type', enum: PropertyType, type: 'enum' })
  type: PropertyType;

  @Column({ name: 'options', type: 'jsonb', nullable: true })
  options: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt: Date;
}
