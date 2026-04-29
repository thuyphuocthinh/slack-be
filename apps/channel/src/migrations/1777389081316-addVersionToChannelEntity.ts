import { MigrationInterface, QueryRunner } from "typeorm";

export class AddVersionToChannelEntity1777389081316 implements MigrationInterface {
    name = 'AddVersionToChannelEntity1777389081316'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "channels" ADD "version" integer NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE "channel_members" ALTER COLUMN "email" SET NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "channel_members" ALTER COLUMN "email" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "version"`);
    }

}
