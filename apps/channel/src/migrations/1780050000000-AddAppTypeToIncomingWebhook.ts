import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAppTypeToIncomingWebhook1780050000000 implements MigrationInterface {
    name = 'AddAppTypeToIncomingWebhook1780050000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "incoming_webhooks" ADD "app_type" character varying(50) NOT NULL DEFAULT 'custom'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "incoming_webhooks" DROP COLUMN "app_type"`);
    }
}
