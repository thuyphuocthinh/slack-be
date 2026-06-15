import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateOAuthTables1781618983000 implements MigrationInterface {
    name = 'CreateOAuthTables1781618983000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create oauth_clients table
        await queryRunner.query(`
            CREATE TABLE "oauth_clients" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "owner_id" uuid NOT NULL,
                "name" character varying(100) NOT NULL,
                "logo_url" character varying(512),
                "client_id" character varying(100) NOT NULL,
                "client_secret" character varying(255) NOT NULL,
                "redirect_uris" text ARRAY NOT NULL,
                "allowed_scopes" character varying ARRAY NOT NULL DEFAULT '{openid,profile,email}',
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_OAUTH_CLIENTS_CLIENT_ID" UNIQUE ("client_id"),
                CONSTRAINT "PK_OAUTH_CLIENTS_ID" PRIMARY KEY ("id")
            )
        `);

        // Create oauth_auth_codes table
        await queryRunner.query(`
            CREATE TABLE "oauth_auth_codes" (
                "code" character varying(100) NOT NULL,
                "client_id" character varying(100) NOT NULL,
                "user_id" uuid NOT NULL,
                "redirect_uri" character varying(512) NOT NULL,
                "scopes" character varying ARRAY NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_OAUTH_AUTH_CODES_CODE" PRIMARY KEY ("code")
            )
        `);

        // Create oauth_tokens table
        await queryRunner.query(`
            CREATE TABLE "oauth_tokens" (
                "access_token" character varying(255) NOT NULL,
                "refresh_token" character varying(255) NOT NULL,
                "client_id" character varying(100) NOT NULL,
                "user_id" uuid NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_OAUTH_TOKENS_REFRESH_TOKEN" UNIQUE ("refresh_token"),
                CONSTRAINT "PK_OAUTH_TOKENS_ACCESS_TOKEN" PRIMARY KEY ("access_token")
            )
        `);

        // Create indexes for performance
        await queryRunner.query(`
            CREATE INDEX "IDX_OAUTH_CLIENTS_OWNER" ON "oauth_clients" ("owner_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_OAUTH_AUTH_CODES_CLIENT_USER" ON "oauth_auth_codes" ("client_id", "user_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_OAUTH_TOKENS_CLIENT_USER" ON "oauth_tokens" ("client_id", "user_id")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop indexes
        await queryRunner.query(`DROP INDEX "IDX_OAUTH_TOKENS_CLIENT_USER"`);
        await queryRunner.query(`DROP INDEX "IDX_OAUTH_AUTH_CODES_CLIENT_USER"`);
        await queryRunner.query(`DROP INDEX "IDX_OAUTH_CLIENTS_OWNER"`);

        // Drop tables
        await queryRunner.query(`DROP TABLE "oauth_tokens"`);
        await queryRunner.query(`DROP TABLE "oauth_auth_codes"`);
        await queryRunner.query(`DROP TABLE "oauth_clients"`);
    }
}
