import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveDenormalizeMember1778032873968 implements MigrationInterface {
    name = 'RemoveDenormalizeMember1778032873968'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "channel_members" DROP COLUMN "avatar_url"`);
        await queryRunner.query(`ALTER TABLE "channel_members" DROP COLUMN "email"`);
        await queryRunner.query(`ALTER TABLE "channel_members" DROP COLUMN "first_name"`);
        await queryRunner.query(`ALTER TABLE "channel_members" DROP COLUMN "last_name"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "channel_members" ADD "last_name" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "channel_members" ADD "first_name" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "channel_members" ADD "email" character varying(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "channel_members" ADD "avatar_url" text`);
    }

}
