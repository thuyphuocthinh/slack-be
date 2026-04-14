import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitVerification1776180643944 implements MigrationInterface {
  name = 'InitVerification1776180643944';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."verifications_action_enum" AS ENUM('verify_email', 'reset_password')`,
    );
    await queryRunner.query(
      `CREATE TABLE "verifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "code" character varying(255) NOT NULL, "is_used" boolean NOT NULL DEFAULT false, "action" "public"."verifications_action_enum" NOT NULL, "expires_at" TIMESTAMP NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2127ad1b143cf012280390b01d1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_verification_user" ON "verifications" ("user_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_verification_user"`);
    await queryRunner.query(`DROP TABLE "verifications"`);
    await queryRunner.query(`DROP TYPE "public"."verifications_action_enum"`);
  }
}
