import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { AiDocumentChunkEntity } from './ai-document-chunk.entity';

@Entity('ai_document_parents')
export class AiDocumentParentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  workspaceId: string;

  @Column({ type: 'varchar' })
  documentName: string;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => AiDocumentChunkEntity, (chunk) => chunk.parent)
  chunks: AiDocumentChunkEntity[];
}
