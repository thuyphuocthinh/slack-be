import { MigrationInterface, QueryRunner } from "typeorm";

export class InitBotEntities1779941000000 implements MigrationInterface {
    name = 'InitBotEntities1779941000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "apps" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "workspace_id" uuid NOT NULL,
                "name" character varying(100) NOT NULL,
                "description" character varying(255),
                "avatar_url" character varying(512),
                "request_url" character varying(512),
                "signing_secret" character varying(128),
                "bot_token" character varying(128),
                "status" character varying NOT NULL DEFAULT 'ACTIVE',
                "slash_commands" jsonb,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_apps_id" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_apps_workspace_id" ON "apps" ("workspace_id")`);

        await queryRunner.query(`
            CREATE TABLE "app_event_subscriptions" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "app_id" uuid NOT NULL,
                "workspace_id" uuid NOT NULL,
                "event_type" character varying(100) NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_app_event_subscriptions_id" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_app_evt_sub_app_id" ON "app_event_subscriptions" ("app_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_app_evt_sub_ws_evt" ON "app_event_subscriptions" ("workspace_id", "event_type")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_app_evt_sub_ws_evt"`);
        await queryRunner.query(`DROP INDEX "IDX_app_evt_sub_app_id"`);
        await queryRunner.query(`DROP TABLE "app_event_subscriptions"`);
        
        await queryRunner.query(`DROP INDEX "IDX_apps_workspace_id"`);
        await queryRunner.query(`DROP TABLE "apps"`);
    }
}
