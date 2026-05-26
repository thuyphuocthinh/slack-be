import { MigrationInterface, QueryRunner } from "typeorm";

export class SetMaxUsageDefaultNotNull1779778129096 implements MigrationInterface {
    name = 'SetMaxUsageDefaultNotNull1779778129096'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE "workspace_links" SET "max_usage" = 50 WHERE "max_usage" IS NULL`);
        await queryRunner.query(`ALTER TABLE "workspace_links" ALTER COLUMN "max_usage" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "workspace_links" ALTER COLUMN "max_usage" SET DEFAULT '50'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "workspace_links" ALTER COLUMN "max_usage" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "workspace_links" ALTER COLUMN "max_usage" DROP NOT NULL`);
    }

}
