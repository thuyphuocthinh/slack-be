import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeToTimestampz1778658867059 implements MigrationInterface {
    name = 'ChangeToTimestampz1778658867059'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "created_at"`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "updated_at"`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "updated_at"`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "updated_at" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "created_at"`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "created_at" TIMESTAMP NOT NULL DEFAULT now()`);
    }

}
