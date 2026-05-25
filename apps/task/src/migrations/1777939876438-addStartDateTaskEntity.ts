import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStartDateTaskEntity1777939876438 implements MigrationInterface {
    name = 'AddStartDateTaskEntity1777939876438'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tasks" ADD "start_date" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "start_date"`);
    }

}
