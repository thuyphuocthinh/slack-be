import { MigrationInterface, QueryRunner } from 'typeorm';

// Hỗ trợ query `WHERE path LIKE 'prefix%'` (PermissionsService.getDescendantPageIds)
// dùng được index thay vì seq-scan toàn bảng pages. Locale mặc định của Postgres
// (không phải "C") khiến btree thường không phục vụ được LIKE prefix — phải dùng
// opclass varchar_pattern_ops.
export class AddPagesPathPatternIndex1793900300000 implements MigrationInterface {
  name = 'AddPagesPathPatternIndex1793900300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_PAGES_PATH_PATTERN" ON "pages"
      USING btree ("path" varchar_pattern_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_PAGES_PATH_PATTERN"`);
  }
}
