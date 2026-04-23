import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { AuditAction, AuditEntityType } from '../types/audit.type';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: AuditAction })
  @Index()
  action: AuditAction;

  @Column({ name: 'actor_id', nullable: true })
  @Index()
  actorId: string;

  @Column({ name: 'target_id', nullable: true })
  @Index()
  targetId: string;

  @Column({ name: 'entity_type', type: 'enum', enum: AuditEntityType })
  @Index()
  entityType: AuditEntityType;

  @Column({ name: 'entity_id' })
  @Index()
  entityId: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
