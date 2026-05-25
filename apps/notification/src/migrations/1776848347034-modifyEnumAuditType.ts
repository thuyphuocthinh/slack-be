import { MigrationInterface, QueryRunner } from 'typeorm';

export class ModifyEnumAuditType1776848347034 implements MigrationInterface {
  name = 'ModifyEnumAuditType1776848347034';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea9ba3dfb39050f831ee3be40d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP COLUMN "entity_type"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_entity_type_enum" AS ENUM('CHANNEL', 'WORKSPACE', 'MESSAGE', 'TASK')`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD "entity_type" "public"."audit_logs_entity_type_enum" NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea9ba3dfb39050f831ee3be40d" ON "audit_logs" ("entity_type") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea9ba3dfb39050f831ee3be40d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP COLUMN "entity_type"`,
    );
    await queryRunner.query(`DROP TYPE "public"."audit_logs_entity_type_enum"`);
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD "entity_type" character varying NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea9ba3dfb39050f831ee3be40d" ON "audit_logs" ("entity_type") `,
    );
  }
}
