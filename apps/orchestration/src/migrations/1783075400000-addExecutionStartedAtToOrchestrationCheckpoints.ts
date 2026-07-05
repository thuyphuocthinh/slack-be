import { MigrationInterface, QueryRunner } from 'typeorm';

// Giai đoạn 4, Step 1 — attempts:1 (Giai đoạn 3) chỉ chặn BullMQ retry-do-lỗi,
// KHÔNG chắc chắn chặn được stalled-job redelivery (2 cơ chế khác nhau trong
// BullMQ). Cột này là 1 claim atomic riêng (WHERE execution_started_at IS
// NULL), độc lập với "status", để processApprovalJob() không chạy lại
// mcpClient.callTool() (không idempotent) lần 2 dù job có bị redeliver kiểu gì.
export class AddExecutionStartedAtToOrchestrationCheckpoints1783075400000 implements MigrationInterface {
  name = 'AddExecutionStartedAtToOrchestrationCheckpoints1783075400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" ADD COLUMN "execution_started_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" DROP COLUMN "execution_started_at"`,
    );
  }
}
