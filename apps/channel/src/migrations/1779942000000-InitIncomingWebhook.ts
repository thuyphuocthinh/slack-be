import { MigrationInterface, QueryRunner } from "typeorm";

export class InitIncomingWebhook1779942000000 implements MigrationInterface {
    name = 'InitIncomingWebhook1779942000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "incoming_webhooks" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "channel_id" uuid NOT NULL,
                "workspace_id" uuid NOT NULL,
                "created_by" uuid NOT NULL,
                "name" character varying(128) NOT NULL DEFAULT 'Incoming Webhook',
                "description" character varying(255),
                "avatar_url" character varying(500),
                "token" character varying NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_incoming_webhooks_token" UNIQUE ("token"),
                CONSTRAINT "PK_incoming_webhooks_id" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_incoming_webhooks_channel_id" ON "incoming_webhooks" ("channel_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_incoming_webhooks_workspace_id" ON "incoming_webhooks" ("workspace_id")`);
        await queryRunner.query(`
            ALTER TABLE "incoming_webhooks" 
            ADD CONSTRAINT "FK_incoming_webhooks_channel_id" 
            FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "incoming_webhooks" DROP CONSTRAINT "FK_incoming_webhooks_channel_id"`);
        await queryRunner.query(`DROP INDEX "IDX_incoming_webhooks_workspace_id"`);
        await queryRunner.query(`DROP INDEX "IDX_incoming_webhooks_channel_id"`);
        await queryRunner.query(`DROP TABLE "incoming_webhooks"`);
    }
}
