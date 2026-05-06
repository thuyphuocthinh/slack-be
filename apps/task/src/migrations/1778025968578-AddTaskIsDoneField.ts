import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTaskIsDoneField1778025968578 implements MigrationInterface {
    name = 'AddTaskIsDoneField1778025968578'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."idx_tasks_title_trgm"`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "is_done" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "is_done"`);
        await queryRunner.query(`CREATE INDEX "idx_tasks_title_trgm" ON "tasks" ("title") `);
    }

}
