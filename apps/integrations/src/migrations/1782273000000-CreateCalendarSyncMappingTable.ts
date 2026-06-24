import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from "typeorm";

export class CreateCalendarSyncMappingTable1782273000000 implements MigrationInterface {
    name = 'CreateCalendarSyncMappingTable1782273000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create ENUM
        await queryRunner.query(`CREATE TYPE "calendar_sync_mappings_sync_status_enum" AS ENUM('pending', 'success', 'failed')`);

        // Create Table
        await queryRunner.createTable(new Table({
            name: "calendar_sync_mappings",
            columns: [
                {
                    name: "id",
                    type: "uuid",
                    isPrimary: true,
                    isGenerated: true,
                    generationStrategy: "uuid",
                },
                {
                    name: "integration_id",
                    type: "uuid",
                },
                {
                    name: "shift_id",
                    type: "uuid",
                },
                {
                    name: "external_event_id",
                    type: "varchar",
                    isNullable: true,
                },
                {
                    name: "sync_status",
                    type: "calendar_sync_mappings_sync_status_enum",
                    default: "'pending'",
                },
                {
                    name: "last_synced_at",
                    type: "timestamp with time zone",
                    isNullable: true,
                },
                {
                    name: "last_error",
                    type: "text",
                    isNullable: true,
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

        // Create Foreign Key
        await queryRunner.createForeignKey("calendar_sync_mappings", new TableForeignKey({
            name: "FK_CALENDAR_SYNC_INTEGRATION_ID",
            columnNames: ["integration_id"],
            referencedColumnNames: ["id"],
            referencedTableName: "user_integrations",
            onDelete: "CASCADE"
        }));

        // Create Indexes
        await queryRunner.createIndex("calendar_sync_mappings", new TableIndex({
            name: "IDX_CALENDAR_SYNC_INTEGRATION_ID",
            columnNames: ["integration_id"]
        }));

        await queryRunner.createIndex("calendar_sync_mappings", new TableIndex({
            name: "IDX_CALENDAR_SYNC_SHIFT_ID",
            columnNames: ["shift_id"]
        }));

        // Create Unique Index
        await queryRunner.createIndex("calendar_sync_mappings", new TableIndex({
            name: "IDX_CALENDAR_SYNC_UNIQUE_MAPPING",
            columnNames: ["integration_id", "shift_id"],
            isUnique: true
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable("calendar_sync_mappings");
        await queryRunner.query(`DROP TYPE "calendar_sync_mappings_sync_status_enum"`);
    }
}
