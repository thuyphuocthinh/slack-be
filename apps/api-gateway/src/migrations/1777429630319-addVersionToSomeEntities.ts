import { MigrationInterface, QueryRunner } from "typeorm";

export class AddVersionToSomeEntities1777429630319 implements MigrationInterface {
    name = 'AddVersionToSomeEntities1777429630319'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "version" integer NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE "task_checklist_items" ADD "version" integer NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE "task_checklists" ADD "version" integer NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE "task_boards" ADD "version" integer NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "version" integer NOT NULL DEFAULT '1'`);
        await queryRunner.query(`CREATE INDEX "IDX_5332a4daa46fd3f4e6625dd275" ON "notifications" ("recipient_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_92f5d3a7779be163cbea7916c6" ON "notifications" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_e7eb735994f992a6a6e63ff96c" ON "channel_members" ("member_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_e996fff1751f5c3e8997c7e7d7" ON "channels" ("workspace_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_e996fff1751f5c3e8997c7e7d7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e7eb735994f992a6a6e63ff96c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_92f5d3a7779be163cbea7916c6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5332a4daa46fd3f4e6625dd275"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "version"`);
        await queryRunner.query(`ALTER TABLE "task_boards" DROP COLUMN "version"`);
        await queryRunner.query(`ALTER TABLE "task_checklists" DROP COLUMN "version"`);
        await queryRunner.query(`ALTER TABLE "task_checklist_items" DROP COLUMN "version"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "version"`);
    }

}
