import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkspaceIdToNotiEntity1777778828280 implements MigrationInterface {
  name = 'AddWorkspaceIdToNotiEntity1777778828280';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "workspace_id" character varying`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ff8a9bf1b558104a843964c01e" ON "notifications" ("workspace_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff8a9bf1b558104a843964c01e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "workspace_id"`,
    );
  }
}
