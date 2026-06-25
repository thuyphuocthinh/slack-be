import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkspaceHolidaysTable1782400000000 implements MigrationInterface {
  name = 'CreateWorkspaceHolidaysTable1782400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "workspace_holidays" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspace_id" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "date" character varying(10) NOT NULL,
        "is_recurring_yearly" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workspace_holidays" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_workspace_holidays_workspace_id" ON "workspace_holidays" ("workspace_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_workspace_holidays_workspace_id_date" ON "workspace_holidays" ("workspace_id", "date")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_workspace_holidays_workspace_id_date"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_workspace_holidays_workspace_id"`);
    await queryRunner.query(`DROP TABLE "workspace_holidays"`);
  }
}
