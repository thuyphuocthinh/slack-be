import { MigrationInterface, QueryRunner } from "typeorm";

export class AlterAccessTokenToText1781618984000 implements MigrationInterface {
    name = 'AlterAccessTokenToText1781618984000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "oauth_tokens" 
            ALTER COLUMN "access_token" TYPE text
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "oauth_tokens" 
            ALTER COLUMN "access_token" TYPE character varying(255)
        `);
    }
}
