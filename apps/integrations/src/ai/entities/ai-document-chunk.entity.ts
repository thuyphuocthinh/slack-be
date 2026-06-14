import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AiDocumentParentEntity } from './ai-document-parent.entity';

@Entity('ai_document_chunks')
export class AiDocumentChunkEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  workspaceId: string;

  @Column({ type: 'varchar' })
  documentName: string;

  @Column({ type: 'uuid', nullable: true })
  parentId: string;

  @ManyToOne(() => AiDocumentParentEntity, (parent) => parent.chunks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parentId' })
  parent: AiDocumentParentEntity;

  @Column({ type: 'int', default: 0 })
  chunkIndex: number;

  @Column({ type: 'text' })
  content: string;

  // pgvector column — stored as text string in TypeORM, raw SQL handles vector type implicit cast
  @Column({
    type: 'varchar',
    nullable: true,
    transformer: {
      to: (value: number[]) => {
        if (!value) return null;
        return `[${value.join(',')}]`;
      },
      from: (value: string) => {
        if (!value) return null;
        if (typeof value === 'string') {
          return value.replace('[', '').replace(']', '').split(',').map(Number);
        }
        return value;
      },
    },
  })
  embedding: number[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
