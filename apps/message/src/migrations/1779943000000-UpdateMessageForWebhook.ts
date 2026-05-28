import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateMessageForWebhook1779943000000 implements MigrationInterface {
    name = 'UpdateMessageForWebhook1779943000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" ALTER COLUMN "user_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "webhook_id" uuid`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "custom_name" character varying`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "custom_avatar_url" character varying`);
        await queryRunner.query(`CREATE INDEX "IDX_messages_webhook_id" ON "messages" ("webhook_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_messages_webhook_id"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "custom_avatar_url"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "custom_name"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "webhook_id"`);
        
        // Cẩn thận khi rollback: nếu có dòng user_id null thì lệnh này sẽ lỗi
        await queryRunner.query(`ALTER TABLE "messages" ALTER COLUMN "user_id" SET NOT NULL`);
    }
}
