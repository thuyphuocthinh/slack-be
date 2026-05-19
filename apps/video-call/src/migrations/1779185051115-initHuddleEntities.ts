import { MigrationInterface, QueryRunner } from "typeorm";

export class InitHuddleEntities1779185051115 implements MigrationInterface {
    name = 'InitHuddleEntities1779185051115'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "huddles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel_id" uuid, "is_active" boolean NOT NULL DEFAULT true, "started_at" TIMESTAMP NOT NULL DEFAULT now(), "ended_at" TIMESTAMP, "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_673f52eff49732592d7d46cbd0e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_68c1671d84da267c1dc2a660de" ON "huddles" ("channel_id") `);
        await queryRunner.query(`CREATE TABLE "huddle_participants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "huddle_id" uuid NOT NULL, "user_id" uuid NOT NULL, "joined_at" TIMESTAMP NOT NULL DEFAULT now(), "left_at" TIMESTAMP, "is_muted" boolean NOT NULL DEFAULT false, "is_screen_sharing" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_730d62325fdb8599b0ba0f03503" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7749a24b3143a3fb65aff69a7d" ON "huddle_participants" ("huddle_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_ecd59f4b1af29123a55575e2c3" ON "huddle_participants" ("user_id") `);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('CHANNEL_CREATED', 'CHANNEL_RENAMED', 'CHANNEL_DELETED', 'USER_ADDED_TO_CHANNEL', 'USER_REMOVED_FROM_CHANNEL', 'WORKSPACE_CREATED', 'WORKSPACE_RENAMED', 'WORKSPACE_DELETED', 'USER_INVITED_TO_WORKSPACE', 'USER_JOINED_WORKSPACE', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'TASK_CREATED', 'TASK_ASSIGNED', 'TASK_UPDATED', 'TASK_DELETED')`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::"text"::"public"."audit_logs_action_enum"`);
        await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum_old" AS ENUM('CHANNEL_CREATED', 'CHANNEL_RENAMED', 'CHANNEL_DELETED', 'USER_ADDED_TO_CHANNEL', 'USER_REMOVED_FROM_CHANNEL', 'WORKSPACE_CREATED', 'WORKSPACE_RENAMED', 'WORKSPACE_DELETED', 'USER_INVITED_TO_WORKSPACE', 'USER_JOINED_WORKSPACE', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'TASK_CREATED', 'TASK_ASSIGNED', 'TASK_UPDATED')`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum_old" USING "action"::"text"::"public"."audit_logs_action_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum_old" RENAME TO "audit_logs_action_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ecd59f4b1af29123a55575e2c3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7749a24b3143a3fb65aff69a7d"`);
        await queryRunner.query(`DROP TABLE "huddle_participants"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_68c1671d84da267c1dc2a660de"`);
        await queryRunner.query(`DROP TABLE "huddles"`);
    }

}
