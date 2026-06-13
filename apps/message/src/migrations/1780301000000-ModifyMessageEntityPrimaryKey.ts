import { MigrationInterface, QueryRunner } from "typeorm";

export class ModifyMessageEntityPrimaryKey1780301000000 implements MigrationInterface {
    name = 'ModifyMessageEntityPrimaryKey1780301000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // No physical DB changes needed since the composite key (id, created_at) 
        // must be maintained for PostgreSQL range partitioning.
        // This migration acts as a placeholder for the TypeORM Entity primary key update.
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }
}
