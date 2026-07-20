import { MigrationInterface, QueryRunner } from 'typeorm';

// accuracy_problem.md mục 1 — checkpoint 'clarification' (chờ user chọn agent
// đúng khi plan() mơ hồ giữa 2+ lựa chọn) dùng CHUNG bảng orchestration_checkpoints
// với 'approval' (hành vi cũ) — không tạo bảng riêng để tái dùng nguyên vẹn cơ
// chế claim/expire/cleanup đã có. pending_tool phải cho phép NULL vì
// 'clarification' không gắn với 1 tool call cụ thể nào.
export class AddClarificationToOrchestrationCheckpoints1784600000000 implements MigrationInterface {
  name = 'AddClarificationToOrchestrationCheckpoints1784600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" ALTER COLUMN "pending_tool" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" ADD COLUMN "kind" character varying NOT NULL DEFAULT 'approval'`,
    );
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" ADD COLUMN "clarification_question" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" ADD COLUMN "clarification_candidates" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" ADD COLUMN "selected_provider" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" DROP COLUMN "selected_provider"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" DROP COLUMN "clarification_candidates"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" DROP COLUMN "clarification_question"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" DROP COLUMN "kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" ALTER COLUMN "pending_tool" SET NOT NULL`,
    );
  }
}
