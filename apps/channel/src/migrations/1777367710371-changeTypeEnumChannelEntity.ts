import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeTypeEnumChannelEntity1777367710371 implements MigrationInterface {
    name = 'ChangeTypeEnumChannelEntity1777367710371'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "type"`);
        await queryRunner.query(`CREATE TYPE "public"."channels_type_enum" AS ENUM('group', 'direct')`);
        await queryRunner.query(`ALTER TABLE "channels" ADD "type" "public"."channels_type_enum" NOT NULL DEFAULT 'group'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "type"`);
        await queryRunner.query(`DROP TYPE "public"."channels_type_enum"`);
        await queryRunner.query(`ALTER TABLE "channels" ADD "type" character varying NOT NULL DEFAULT 'group'`);
    }

}
