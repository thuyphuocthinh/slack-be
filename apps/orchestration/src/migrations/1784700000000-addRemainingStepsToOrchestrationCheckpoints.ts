import { MigrationInterface, QueryRunner } from 'typeorm';

// accuracy_problem.md mục 9.2 — checkpoint 'approval' trước đây chỉ lưu
// `rounds_so_far` (các bước ĐÃ chạy xong) — KHÔNG lưu các bước CÒN LẠI CHƯA
// CHẠY của kế hoạch gốc (VD dừng ở bước A cần duyệt, B/C vẫn còn trong `steps`
// nhưng chỉ tồn tại trong RAM của job, mất sạch nếu không lưu lại). Sau khi
// duyệt, continueRounds() buộc phải gọi plan() lại HOÀN TOÀN TỪ ĐẦU — không
// có gì đảm bảo bản plan() mới không bỏ sót B/C. Lưu lại để resume ĐÚNG theo
// kế hoạch gốc thay vì "hy vọng" LLM tự nghĩ lại y hệt.
export class AddRemainingStepsToOrchestrationCheckpoints1784700000000 implements MigrationInterface {
  name = 'AddRemainingStepsToOrchestrationCheckpoints1784700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" ADD COLUMN "remaining_steps" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" DROP COLUMN "remaining_steps"`,
    );
  }
}
