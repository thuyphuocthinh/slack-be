import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPagesTitleFtsIndex1793900100000 implements MigrationInterface {
  name = 'AddPagesTitleFtsIndex1793900100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_PAGES_TITLE_FTS" ON "pages"
      USING GIN (to_tsvector('simple', "title"))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_PAGES_TITLE_FTS"`);
  }
}
