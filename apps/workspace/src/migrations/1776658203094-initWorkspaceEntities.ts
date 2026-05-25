import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitWorkspaceEntities1776658203094 implements MigrationInterface {
  name = 'InitWorkspaceEntities1776658203094';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."workspace_links_type_enum" AS ENUM('public_invite')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."workspace_links_status_enum" AS ENUM('active', 'disabled', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TABLE "workspace_links" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "type" "public"."workspace_links_type_enum" NOT NULL, "token_hash" character varying(255) NOT NULL, "status" "public"."workspace_links_status_enum" NOT NULL DEFAULT 'active', "max_usage" integer, "used_count" integer NOT NULL DEFAULT '0', "expires_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_fd7b14173aacee492dabb541509" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2d8d6ef37de35397fd9fd64f44" ON "workspace_links" ("workspace_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "workspaces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(255), "logo" character varying(512), "deleted_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_b8e9fe62e93d60089dfc4f175f3" UNIQUE ("slug"), CONSTRAINT "PK_098656ae401f3e1a4586f47fd8e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b8e9fe62e93d60089dfc4f175f" ON "workspaces" ("slug") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."workspace_members_role_enum" AS ENUM('owner', 'admin', 'member')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."workspace_members_status_enum" AS ENUM('active', 'removed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "workspace_members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" "public"."workspace_members_role_enum" NOT NULL, "status" "public"."workspace_members_status_enum" NOT NULL DEFAULT 'active', "joined_at" TIMESTAMP NOT NULL DEFAULT now(), "removed_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_4896b609c71ca5ad20ad662077b" UNIQUE ("workspace_id", "user_id"), CONSTRAINT "PK_22ab43ac5865cd62769121d2bc4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a7c584ddfe855379598b5e20f" ON "workspace_members" ("workspace_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4e83431119fa585fc7aa8b817d" ON "workspace_members" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "user_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" character varying NOT NULL, "settings" jsonb NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_00f004f5922a0744d174530d639" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_USER_SETTINGS_USER_ID" ON "user_settings" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."workspace_invites_role_enum" AS ENUM('owner', 'admin', 'member')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."workspace_invites_status_enum" AS ENUM('pending', 'accepted', 'revoked', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TABLE "workspace_invites" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "email" character varying(255) NOT NULL, "role" "public"."workspace_invites_role_enum" NOT NULL, "token_hash" character varying(255) NOT NULL, "status" "public"."workspace_invites_status_enum" NOT NULL DEFAULT 'pending', "invited_by" uuid NOT NULL, "expires_at" TIMESTAMP NOT NULL, "accepted_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_43f7a0e0b0549fe2581e9cb57bc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9ffc4e5b893e8fb91d66d466f6" ON "workspace_invites" ("workspace_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_519a6f93e486dc281dc3c3a532" ON "workspace_invites" ("email") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_519a6f93e486dc281dc3c3a532"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9ffc4e5b893e8fb91d66d466f6"`,
    );
    await queryRunner.query(`DROP TABLE "workspace_invites"`);
    await queryRunner.query(
      `DROP TYPE "public"."workspace_invites_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."workspace_invites_role_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_USER_SETTINGS_USER_ID"`);
    await queryRunner.query(`DROP TABLE "user_settings"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4e83431119fa585fc7aa8b817d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a7c584ddfe855379598b5e20f"`,
    );
    await queryRunner.query(`DROP TABLE "workspace_members"`);
    await queryRunner.query(
      `DROP TYPE "public"."workspace_members_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."workspace_members_role_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b8e9fe62e93d60089dfc4f175f"`,
    );
    await queryRunner.query(`DROP TABLE "workspaces"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2d8d6ef37de35397fd9fd64f44"`,
    );
    await queryRunner.query(`DROP TABLE "workspace_links"`);
    await queryRunner.query(`DROP TYPE "public"."workspace_links_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."workspace_links_type_enum"`);
  }
}
