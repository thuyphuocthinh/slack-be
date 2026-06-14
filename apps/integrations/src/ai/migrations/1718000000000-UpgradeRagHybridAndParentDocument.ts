import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpgradeRagHybridAndParentDocument1718000000000 implements MigrationInterface {
  name = 'UpgradeRagHybridAndParentDocument1718000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create ai_document_parents table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_document_parents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" varchar NOT NULL,
        "documentName" varchar NOT NULL,
        "content" text NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_document_parents" PRIMARY KEY ("id")
      )
    `);

    // 2. Add parentId column to ai_document_chunks
    await queryRunner.query(`
      ALTER TABLE "ai_document_chunks" 
      ADD COLUMN IF NOT EXISTS "parentId" uuid REFERENCES "ai_document_parents"("id") ON DELETE CASCADE
    `);

    // 3. Create FTS GIN index on content
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_doc_chunks_fts" 
      ON "ai_document_chunks" 
      USING gin(to_tsvector('simple', "content"))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ai_doc_chunks_fts"`);
    await queryRunner.query(`ALTER TABLE "ai_document_chunks" DROP COLUMN IF EXISTS "parentId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_document_parents"`);
  }
}
