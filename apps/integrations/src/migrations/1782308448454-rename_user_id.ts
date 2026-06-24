import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameUserId1782308448454 implements MigrationInterface {
    name = 'RenameUserId1782308448454'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_integrations" RENAME COLUMN "userId" TO "user_id"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_integrations" RENAME COLUMN "user_id" TO "userId"`);
    }
}
