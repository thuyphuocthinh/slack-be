import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeAuditType1778753801719 implements MigrationInterface {
    name = 'ChangeAuditType1778753801719'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('CHANNEL_CREATED', 'CHANNEL_RENAMED', 'CHANNEL_DELETED', 'USER_ADDED_TO_CHANNEL', 'USER_REMOVED_FROM_CHANNEL', 'WORKSPACE_CREATED', 'WORKSPACE_RENAMED', 'WORKSPACE_DELETED', 'USER_INVITED_TO_WORKSPACE', 'USER_JOINED_WORKSPACE', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'TASK_CREATED', 'TASK_ASSIGNED', 'TASK_UPDATED')`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::"text"::"public"."audit_logs_action_enum"`);
        await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum_old" AS ENUM('CHANNEL_CREATED', 'CHANNEL_RENAMED', 'USER_ADDED_TO_CHANNEL', 'USER_REMOVED_FROM_CHANNEL', 'USER_INVITED_TO_WORKSPACE', 'USER_JOINED_WORKSPACE', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'TASK_CREATED', 'TASK_ASSIGNED', 'TASK_UPDATED')`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum_old" USING "action"::"text"::"public"."audit_logs_action_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum_old" RENAME TO "audit_logs_action_enum"`);
    }

}
