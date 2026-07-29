import { MigrationInterface, QueryRunner } from 'typeorm';

// ver3.md mục 1 (dài hạn) — bảng ghi nhớ THỰC THỂ ổn định vừa được tạo thành
// công trong 1 channel (VD trang Notion, spreadsheet mới...), đọc lại làm gợi
// ý ngữ cảnh cho SupervisorService.plan(). Unique index (source_message_id,
// content) chặn ghi trùng khi 1 message được updateMessage() nhiều lần với
// cùng 1 toolCall đã persist trước đó (luồng HITL pause → resume).
export class CreateChannelMemory1785296490532 implements MigrationInterface {
  name = 'CreateChannelMemory1785296490532';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "channel_memory" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "channel_id" uuid NOT NULL,
        "source_message_id" uuid NOT NULL,
        "tool" varchar NOT NULL,
        "content" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_channel_memory" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_channel_memory_channel_id" ON "channel_memory" ("channel_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_channel_memory_source_message_content" ON "channel_memory" ("source_message_id", "content")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "channel_memory"`);
  }
}
