import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('ai_document_chunks')
export class AiDocumentChunkEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  workspaceId: string;

  @Column({ type: 'varchar' })
  documentName: string;

  @Column({ type: 'int', default: 0 })
  chunkIndex: number;

  @Column({ type: 'text' })
  content: string;

  // pgvector column — stored as float[] in TypeORM, raw SQL handles vector type
  @Column({ type: 'float', array: true, nullable: true })
  embedding: number[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
