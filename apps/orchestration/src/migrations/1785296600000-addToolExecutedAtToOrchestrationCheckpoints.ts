import { MigrationInterface, QueryRunner } from 'typeorm';

// Bug fix — recoverStalledExecutions() không phân biệt được worker crash
// TRƯỚC khi tool chạy (an toàn để báo "thử lại") với crash SAU KHI tool đã
// ghi thành công (báo "thử lại" ở đây gây ghi trùng). Cột này set NGAY SAU
// executeApprovedToolForReal() thành công, tách biệt với execution_started_at.
export class AddToolExecutedAtToOrchestrationCheckpoints1785296600000 implements MigrationInterface {
  name = 'AddToolExecutedAtToOrchestrationCheckpoints1785296600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" ADD COLUMN "tool_executed_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" DROP COLUMN "tool_executed_at"`,
    );
  }
}
