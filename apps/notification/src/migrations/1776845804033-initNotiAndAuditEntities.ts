import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitNotiAndAuditEntities1776845804033 implements MigrationInterface {
  name = 'InitNotiAndAuditEntities1776845804033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."notifications_type_enum" AS ENUM('MESSAGE_RECEIVED', 'MENTIONED_IN_MESSAGE', 'REPLY_IN_THREAD', 'REACTION_ADDED', 'ADDED_TO_CHANNEL', 'REMOVED_FROM_CHANNEL', 'TASK_ASSIGNED', 'TASK_UPDATED', 'WORKSPACE_INVITED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notifications_status_enum" AS ENUM('unread', 'read', 'archived')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "recipient_id" character varying NOT NULL, "template_key" character varying NOT NULL, "content" character varying(255), "type" "public"."notifications_type_enum" NOT NULL, "status" "public"."notifications_status_enum" NOT NULL DEFAULT 'unread', "object_id" character varying NOT NULL, "object_type" character varying NOT NULL, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('CHANNEL_CREATED', 'CHANNEL_RENAMED', 'USER_ADDED_TO_CHANNEL', 'USER_REMOVED_FROM_CHANNEL', 'USER_INVITED_TO_WORKSPACE', 'USER_JOINED_WORKSPACE', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'TASK_CREATED', 'TASK_ASSIGNED', 'TASK_UPDATED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "action" "public"."audit_logs_action_enum" NOT NULL, "actor_id" character varying, "target_id" character varying, "entity_type" character varying NOT NULL, "entity_id" character varying NOT NULL, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cee5459245f652b75eb2759b4c" ON "audit_logs" ("action") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_177183f29f438c488b5e8510cd" ON "audit_logs" ("actor_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3cd01cd3ae7aab010310d96ac8" ON "audit_logs" ("target_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea9ba3dfb39050f831ee3be40d" ON "audit_logs" ("entity_type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_85c204d8e47769ac183b32bf9c" ON "audit_logs" ("entity_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_85c204d8e47769ac183b32bf9c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea9ba3dfb39050f831ee3be40d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3cd01cd3ae7aab010310d96ac8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_177183f29f438c488b5e8510cd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cee5459245f652b75eb2759b4c"`,
    );
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TYPE "public"."notifications_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
  }
}
