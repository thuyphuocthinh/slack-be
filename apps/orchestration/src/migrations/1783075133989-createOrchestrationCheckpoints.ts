import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrchestrationCheckpoints1783075133989 implements MigrationInterface {
  name = 'CreateOrchestrationCheckpoints1783075133989';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "orchestration_checkpoints_status_enum" AS ENUM ('pending', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TABLE "orchestration_checkpoints" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reply_message_id" uuid NOT NULL, "user_id" uuid NOT NULL, "channel_id" uuid NOT NULL, "workspace_id" uuid NOT NULL, "channel_type" character varying NOT NULL, "original_prompt" text NOT NULL, "pending_tool" jsonb NOT NULL, "pending_task" text NOT NULL, "rounds_so_far" jsonb NOT NULL DEFAULT '[]', "history" jsonb NOT NULL DEFAULT '[]', "status" "orchestration_checkpoints_status_enum" NOT NULL DEFAULT 'pending', "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_orchestration_checkpoints_reply_message_id" UNIQUE ("reply_message_id"), CONSTRAINT "PK_orchestration_checkpoints" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orchestration_checkpoints_user_id" ON "orchestration_checkpoints" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_orchestration_checkpoints_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "orchestration_checkpoints"`);
    await queryRunner.query(
      `DROP TYPE "orchestration_checkpoints_status_enum"`,
    );
  }
}
