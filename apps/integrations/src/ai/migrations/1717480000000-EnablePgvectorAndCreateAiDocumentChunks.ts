import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnablePgvectorAndCreateAiDocumentChunks1717480000000 implements MigrationInterface {
  name = 'EnablePgvectorAndCreateAiDocumentChunks1717480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable pgvector extension
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // Create ai_document_chunks table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_document_chunks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" varchar NOT NULL,
        "documentName" varchar NOT NULL,
        "chunkIndex" int NOT NULL DEFAULT 0,
        "content" text NOT NULL,
        "embedding" vector(768),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_document_chunks" PRIMARY KEY ("id")
      )
    `);

    // Create index for workspace filtering + cosine similarity search
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_doc_chunks_workspace" 
      ON "ai_document_chunks" ("workspaceId")
    `);

    // Create HNSW index for fast vector similarity search
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_doc_chunks_embedding" 
      ON "ai_document_chunks" 
      USING hnsw ("embedding" vector_cosine_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ai_doc_chunks_embedding"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ai_doc_chunks_workspace"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_document_chunks"`);
  }
}
