import { MigrationInterface, QueryRunner } from "typeorm";

export class AllowNullChannelTitle1778165585914 implements MigrationInterface {
    name = 'AllowNullChannelTitle1778165585914'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "channels" DROP CONSTRAINT "UQ_8f12fee54f4cb360bf355a6580f"`);
        await queryRunner.query(`ALTER TABLE "channels" ALTER COLUMN "title" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "channels" ALTER COLUMN "title" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "channels" ADD CONSTRAINT "UQ_8f12fee54f4cb360bf355a6580f" UNIQUE ("workspace_id", "title")`);
    }

}
