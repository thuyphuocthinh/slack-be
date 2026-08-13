import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageFeedbackTable1780400000000 implements MigrationInterface {
  name = 'AddMessageFeedbackTable1780400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Không thêm FOREIGN KEY thật trỏ vào messages(id) — từ migration
    // PartitionMessagesTable1780300000000, "messages" đã partition theo
    // created_at, PK là composite (id, created_at), không còn unique
    // constraint đơn trên "id" để FK tham chiếu (lỗi Postgres 42830). Cùng lý
    // do message_reactions/message_mentions/message_attachments cũng không
    // có FK thật — dựa vào trigger delete_message_dependencies() (tạo ở
    // PartitionMessagesTable1780300000000) để tự xoá cascade khi xoá message.
    await queryRunner.query(
      `CREATE TABLE "message_feedback" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "message_id" uuid NOT NULL, "user_id" uuid NOT NULL, "type" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_message_feedback_message_user" UNIQUE ("message_id", "user_id"), CONSTRAINT "PK_message_feedback_id" PRIMARY KEY ("id"))`,
    );

    // Cập nhật trigger function có sẵn để CŨNG xoá message_feedback khi 1
    // message bị xoá — bảng này chưa tồn tại lúc trigger được tạo lần đầu.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION delete_message_dependencies()
      RETURNS TRIGGER AS $$
      BEGIN
          DELETE FROM "message_reactions" WHERE "message_id" = OLD.id;
          DELETE FROM "message_mentions" WHERE "message_id" = OLD.id;
          DELETE FROM "message_attachments" WHERE "message_id" = OLD.id;
          DELETE FROM "message_feedback" WHERE "message_id" = OLD.id;
          DELETE FROM "messages" WHERE "parent_id" = OLD.id;
          RETURN OLD;
      END;
      $$ LANGUAGE plpgsql;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Trả trigger về đúng bản trước (không xoá message_feedback nữa) trước
    // khi drop bảng.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION delete_message_dependencies()
      RETURNS TRIGGER AS $$
      BEGIN
          DELETE FROM "message_reactions" WHERE "message_id" = OLD.id;
          DELETE FROM "message_mentions" WHERE "message_id" = OLD.id;
          DELETE FROM "message_attachments" WHERE "message_id" = OLD.id;
          DELETE FROM "messages" WHERE "parent_id" = OLD.id;
          RETURN OLD;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`DROP TABLE "message_feedback"`);
  }
}
