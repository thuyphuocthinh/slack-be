import { MigrationInterface, QueryRunner } from 'typeorm';

// Sửa bug: resolveApproval() dùng userId (người duyệt) thay vì botUserId
// (người GỬI message "approval_request") khi gọi updateMessage() -> message
// service chặn với ERR.MESSAGE.0103 (chỉ sender mới được sửa message của
// chính mình). Nullable vì checkpoint tạo TRƯỚC migration này không có giá
// trị -- coi là dữ liệu cũ, không dùng lại được (nên reject/để tự hết hạn).
export class AddBotUserIdToOrchestrationCheckpoints1783075200000 implements MigrationInterface {
  name = 'AddBotUserIdToOrchestrationCheckpoints1783075200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" ADD COLUMN "bot_user_id" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" DROP COLUMN "bot_user_id"`,
    );
  }
}
