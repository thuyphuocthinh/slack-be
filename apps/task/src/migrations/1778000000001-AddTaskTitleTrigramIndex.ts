import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskTitleTrigramIndex1778000000001 implements MigrationInterface {
  name = 'AddTaskTitleTrigramIndex1778000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Kích hoạt extension pg_trgm (nếu chưa có)
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    
    // 2. Tạo GIN Index với gin_trgm_ops để tối ưu cho ILIKE %name%
    await queryRunner.query(
      `CREATE INDEX "idx_tasks_title_trgm" ON "tasks" USING gin ("title" gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_tasks_title_trgm"`);
  }
}
