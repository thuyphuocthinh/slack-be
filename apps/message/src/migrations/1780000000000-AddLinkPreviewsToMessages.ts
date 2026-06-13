import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLinkPreviewsToMessages1780000000000 implements MigrationInterface {
    name = 'AddLinkPreviewsToMessages1780000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" ADD "link_previews" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "link_previews"`);
    }
}
