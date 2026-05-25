import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitResourceEntity1776407768200 implements MigrationInterface {
  name = 'InitResourceEntity1776407768200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."resources_type_enum" AS ENUM('image', 'video', 'file', 'avatar')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."resources_scope_enum" AS ENUM('global', 'workspace')`,
    );
    await queryRunner.query(
      `CREATE TABLE "resources" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "public_id" character varying NOT NULL, "url" character varying NOT NULL, "thumbnail_url" character varying, "filename" character varying NOT NULL, "mime_type" character varying NOT NULL, "size" integer NOT NULL, "type" "public"."resources_type_enum" NOT NULL, "workspace_id" uuid, "scope" "public"."resources_scope_enum" NOT NULL DEFAULT 'global', "uploaded_by" uuid NOT NULL, "ref_type" character varying, "ref_id" character varying, "is_deleted" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_632484ab9dff41bba94f9b7c85e" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "resources"`);
    await queryRunner.query(`DROP TYPE "public"."resources_scope_enum"`);
    await queryRunner.query(`DROP TYPE "public"."resources_type_enum"`);
  }
}
