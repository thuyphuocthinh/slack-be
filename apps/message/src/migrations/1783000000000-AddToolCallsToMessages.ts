import { MigrationInterface, QueryRunner } from "typeorm";

export class AddToolCallsToMessages1783000000000 implements MigrationInterface {
    name = 'AddToolCallsToMessages1783000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" ADD "tool_calls" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "tool_calls"`);
    }
}
