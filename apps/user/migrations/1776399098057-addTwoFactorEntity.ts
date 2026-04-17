import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTwoFactorEntity1776399098057 implements MigrationInterface {
  name = 'AddTwoFactorEntity1776399098057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "two_factor" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" character varying NOT NULL, "secret" character varying NOT NULL, "enabled" boolean NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d9e707ebc943c110fcaab7cdd8c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_TWO_FACTOR_USER_ID" ON "two_factor" ("user_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_TWO_FACTOR_USER_ID"`);
    await queryRunner.query(`DROP TABLE "two_factor"`);
  }
}
