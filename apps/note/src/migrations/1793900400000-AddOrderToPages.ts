import { MigrationInterface, QueryRunner } from 'typeorm';

// Cho phép sắp xếp thủ công (move/reorder) trang trong cùng 1 cha, thay vì
// chỉ hiện theo createdAt. Backfill dựa trên thứ tự tạo hiện có trong từng
// nhóm (workspace_id, parent_id) — parent_id NULL (trang gốc) được Postgres
// coi là cùng 1 group khi PARTITION BY, đúng ý muốn.
export class AddOrderToPages1793900400000 implements MigrationInterface {
  name = 'AddOrderToPages1793900400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pages" ADD "order" integer NOT NULL DEFAULT 0`,
    );

    await queryRunner.query(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY workspace_id, parent_id ORDER BY created_at ASC
        ) - 1 AS rn
        FROM pages
      )
      UPDATE pages SET "order" = ranked.rn
      FROM ranked
      WHERE pages.id = ranked.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "pages" DROP COLUMN "order"`);
  }
}
