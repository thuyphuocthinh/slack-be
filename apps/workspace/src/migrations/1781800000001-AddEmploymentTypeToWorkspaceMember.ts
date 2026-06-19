import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmploymentTypeToWorkspaceMember1781800000001 implements MigrationInterface {
  name = 'AddEmploymentTypeToWorkspaceMember1781800000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."employment_type_enum" AS ENUM('FULLTIME', 'PARTTIME')`);
    await queryRunner.query(`ALTER TABLE "workspace_members" ADD "employment_type" "public"."employment_type_enum" NOT NULL DEFAULT 'FULLTIME'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "workspace_members" DROP COLUMN "employment_type"`);
    await queryRunner.query(`DROP TYPE "public"."employment_type_enum"`);
  }
}
