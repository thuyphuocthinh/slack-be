import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitAuthAndSession1776179108943 implements MigrationInterface {
  name = 'InitAuthAndSession1776179108943';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "refresh_token" character varying(512) NOT NULL, "device" character varying(255), "ip_address" character varying(45), "user_agent" character varying(255), "is_revoked" boolean NOT NULL DEFAULT false, "expires_at" TIMESTAMP NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."auth_provider_type_enum" AS ENUM('local', 'google')`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "provider_type" "public"."auth_provider_type_enum" NOT NULL, "provider_id" character varying(255) NOT NULL, "password" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7e416cf6172bc5aec04244f6459" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "auth"`);
    await queryRunner.query(`DROP TYPE "public"."auth_provider_type_enum"`);
    await queryRunner.query(`DROP TABLE "sessions"`);
  }
}
