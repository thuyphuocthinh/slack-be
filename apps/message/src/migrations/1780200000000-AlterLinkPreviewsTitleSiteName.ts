import { MigrationInterface, QueryRunner } from "typeorm";

export class AlterLinkPreviewsTitleSiteName1780200000000 implements MigrationInterface {
    name = 'AlterLinkPreviewsTitleSiteName1780200000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "link_previews" ALTER COLUMN "title" TYPE text`);
        await queryRunner.query(`ALTER TABLE "link_previews" ALTER COLUMN "site_name" TYPE text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "link_previews" ALTER COLUMN "title" TYPE character varying(255)`);
        await queryRunner.query(`ALTER TABLE "link_previews" ALTER COLUMN "site_name" TYPE character varying(100)`);
    }
}
