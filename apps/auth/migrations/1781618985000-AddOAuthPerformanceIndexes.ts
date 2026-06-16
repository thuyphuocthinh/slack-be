import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOAuthPerformanceIndexes1781618985000 implements MigrationInterface {
    name = 'AddOAuthPerformanceIndexes1781618985000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE INDEX "IDX_OAUTH_TOKENS_USER_ID" ON "oauth_tokens" ("user_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_OAUTH_TOKENS_CLIENT_ID" ON "oauth_tokens" ("client_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_OAUTH_TOKENS_USER_CLIENT_ID" ON "oauth_tokens" ("user_id", "client_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_OAUTH_AUTH_CODES_USER_ID" ON "oauth_auth_codes" ("user_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_OAUTH_AUTH_CODES_CLIENT_ID" ON "oauth_auth_codes" ("client_id")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_OAUTH_AUTH_CODES_CLIENT_ID"`);
        await queryRunner.query(`DROP INDEX "IDX_OAUTH_AUTH_CODES_USER_ID"`);
        await queryRunner.query(`DROP INDEX "IDX_OAUTH_TOKENS_USER_CLIENT_ID"`);
        await queryRunner.query(`DROP INDEX "IDX_OAUTH_TOKENS_CLIENT_ID"`);
        await queryRunner.query(`DROP INDEX "IDX_OAUTH_TOKENS_USER_ID"`);
    }
}
