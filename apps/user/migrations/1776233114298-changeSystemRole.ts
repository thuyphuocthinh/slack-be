import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeSystemRole1776233114298 implements MigrationInterface {
  name = 'ChangeSystemRole1776233114298';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" RENAME COLUMN "system_role_id" TO "system_role"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "system_role"`);
    await queryRunner.query(
      `CREATE TYPE "public"."users_system_role_enum" AS ENUM('admin', 'user')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "system_role" "public"."users_system_role_enum" NOT NULL DEFAULT 'user'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "system_role"`);
    await queryRunner.query(`DROP TYPE "public"."users_system_role_enum"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "system_role" uuid NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" RENAME COLUMN "system_role" TO "system_role_id"`,
    );
  }
}
