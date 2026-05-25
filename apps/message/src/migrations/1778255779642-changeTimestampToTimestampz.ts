import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeTimestampToTimestampz1778255779642 implements MigrationInterface {
    name = 'ChangeTimestampToTimestampz1778255779642'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "created_at"`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "updated_at"`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "updated_at"`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "updated_at" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "created_at"`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "created_at" TIMESTAMP NOT NULL DEFAULT now()`);
    }

}
