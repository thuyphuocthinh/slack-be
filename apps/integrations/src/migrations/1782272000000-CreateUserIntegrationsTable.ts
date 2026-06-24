import { MigrationInterface, QueryRunner, Table, TableIndex, TableColumn } from "typeorm";

export class CreateUserIntegrationsTable1782272000000 implements MigrationInterface {
    name = 'CreateUserIntegrationsTable1782272000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create ENUMs
        await queryRunner.query(`CREATE TYPE "user_integrations_target_type_enum" AS ENUM('user', 'workspace')`);
        await queryRunner.query(`CREATE TYPE "user_integrations_provider_enum" AS ENUM('google', 'zoom', 'slack', 'github', 'notion', 'trello', 'jira', 'microsoft', 'line', 'discord', 'figma', 'dropbox')`);
        await queryRunner.query(`CREATE TYPE "user_integrations_status_enum" AS ENUM('connected', 'disconnected')`);

        // Create Table
        await queryRunner.createTable(new Table({
            name: "user_integrations",
            columns: [
                {
                    name: "id",
                    type: "uuid",
                    isPrimary: true,
                    isGenerated: true,
                    generationStrategy: "uuid",
                },
                {
                    name: "userId",
                    type: "uuid",
                },
                {
                    name: "workspace_id",
                    type: "uuid",
                    isNullable: true,
                },
                {
                    name: "target_type",
                    type: "user_integrations_target_type_enum",
                    default: "'user'",
                },
                {
                    name: "provider",
                    type: "user_integrations_provider_enum",
                },
                {
                    name: "provider_account_id",
                    type: "varchar",
                    isNullable: true,
                },
                {
                    name: "access_token",
                    type: "text",
                },
                {
                    name: "refresh_token",
                    type: "text",
                    isNullable: true,
                },
                {
                    name: "token_expiry",
                    type: "timestamp with time zone",
                    isNullable: true,
                },
                {
                    name: "metadata",
                    type: "jsonb",
                    isNullable: true,
                },
                {
                    name: "scopes",
                    type: "jsonb",
                    isNullable: true,
                },
                {
                    name: "status",
                    type: "user_integrations_status_enum",
                    default: "'connected'",
                },
                {
                    name: "created_at",
                    type: "timestamp with time zone",
                    default: "now()",
                },
                {
                    name: "updated_at",
                    type: "timestamp with time zone",
                    default: "now()",
                }
            ]
        }), true);

        // Create Indexes
        await queryRunner.createIndex("user_integrations", new TableIndex({
            name: "IDX_USER_INTEGRATIONS_USERID",
            columnNames: ["userId"]
        }));

        await queryRunner.createIndex("user_integrations", new TableIndex({
            name: "IDX_USER_INTEGRATIONS_WORKSPACEID",
            columnNames: ["workspace_id"]
        }));

        // PostgreSQL treats NULLs as distinct values in unique indexes by default.
        // We use COALESCE to ensure a user only has ONE null account per provider if they don't specify an account ID.
        // But since TypeORM @Index decorator doesn't easily support expressions without custom definition,
        // we will just create a standard unique index as TypeORM would have generated it.
        await queryRunner.createIndex("user_integrations", new TableIndex({
            name: "IDX_USER_INTEGRATIONS_UNIQUE_ACCOUNT",
            columnNames: ["userId", "provider", "provider_account_id"],
            isUnique: true
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable("user_integrations");
        await queryRunner.query(`DROP TYPE "user_integrations_status_enum"`);
        await queryRunner.query(`DROP TYPE "user_integrations_provider_enum"`);
        await queryRunner.query(`DROP TYPE "user_integrations_target_type_enum"`);
    }
}
