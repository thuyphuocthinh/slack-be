import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBlocksContentTextFtsIndex1793900200000 implements MigrationInterface {
  name = 'AddBlocksContentTextFtsIndex1793900200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "blocks" ADD COLUMN "content_text" text
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_BLOCKS_CONTENT_TEXT_FTS" ON "blocks"
      USING GIN (to_tsvector('simple', "content_text"))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_BLOCKS_CONTENT_TEXT_FTS"`,
    );
    await queryRunner.query(`ALTER TABLE "blocks" DROP COLUMN "content_text"`);
  }
}
