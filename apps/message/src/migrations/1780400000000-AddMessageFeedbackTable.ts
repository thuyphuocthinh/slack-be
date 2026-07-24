import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageFeedbackTable1780400000000 implements MigrationInterface {
  name = 'AddMessageFeedbackTable1780400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "message_feedback" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "message_id" uuid NOT NULL, "user_id" uuid NOT NULL, "type" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_message_feedback_message_user" UNIQUE ("message_id", "user_id"), CONSTRAINT "PK_message_feedback_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_feedback" ADD CONSTRAINT "FK_message_feedback_message_id" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message_feedback" DROP CONSTRAINT "FK_message_feedback_message_id"`,
    );
    await queryRunner.query(`DROP TABLE "message_feedback"`);
  }
}
