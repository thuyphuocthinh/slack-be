import { MigrationInterface, QueryRunner } from 'typeorm';

// Giai đoạn 4, Step 1 — bảng "claim" atomic chặn PROCESS_AI_TRIGGER chạy lại
// (BullMQ retry/stalled) tạo thêm message "Đang xử lý..." trùng cho cùng 1
// message gốc.
export class CreateOrchestrationTriggerClaims1783075300000 implements MigrationInterface {
  name = 'CreateOrchestrationTriggerClaims1783075300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "orchestration_trigger_claims" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "trigger_message_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_orchestration_trigger_claims_trigger_message_id" UNIQUE ("trigger_message_id"), CONSTRAINT "PK_orchestration_trigger_claims" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "orchestration_trigger_claims"`);
  }
}
