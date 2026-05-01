import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeNotiTypeEnum1777605025519 implements MigrationInterface {
  name = 'ChangeNotiTypeEnum1777605025519';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "channel_members" ADD "last_read_message_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_members" ADD "unread_count" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."notifications_type_enum" RENAME TO "notifications_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notifications_type_enum" AS ENUM('message_received', 'mentioned_in_message', 'reply_in_thread', 'message_reaction_added', 'user_added_to_channel', 'user_removed_from_channel', 'channel_created', 'channel_renamed', 'invited_to_workspace', 'joined_workspace', 'task_assigned', 'task_updated', 'task_due_soon', 'system_announcement', 'workspace_invited')`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "public"."notifications_type_enum" USING "type"::"text"::"public"."notifications_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."notifications_type_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."notifications_type_enum_old" AS ENUM('MESSAGE_RECEIVED', 'MENTIONED_IN_MESSAGE', 'REPLY_IN_THREAD', 'REACTION_ADDED', 'ADDED_TO_CHANNEL', 'REMOVED_FROM_CHANNEL', 'TASK_ASSIGNED', 'TASK_UPDATED', 'WORKSPACE_INVITED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "public"."notifications_type_enum_old" USING "type"::"text"::"public"."notifications_type_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."notifications_type_enum_old" RENAME TO "notifications_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_members" DROP COLUMN "unread_count"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_members" DROP COLUMN "last_read_message_id"`,
    );
  }
}
