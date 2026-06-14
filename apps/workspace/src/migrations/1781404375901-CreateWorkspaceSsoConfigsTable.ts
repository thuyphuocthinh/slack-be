import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkspaceSsoConfigsTable1781404375901 implements MigrationInterface {
  name = 'CreateWorkspaceSsoConfigsTable1781404375901';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "workspace_sso_configs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspace_id" uuid NOT NULL,
        "domain" character varying(100) NOT NULL,
        "provider_type" character varying(10) NOT NULL,
        "entry_point" character varying(512),
        "idp_cert" text,
        "issuer" character varying(255),
        "client_id" character varying(255),
        "client_secret" character varying(255),
        "discovery_url" character varying(512),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workspace_sso_configs_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_workspace_sso_configs_workspace_id" UNIQUE ("workspace_id"),
        CONSTRAINT "UQ_workspace_sso_configs_domain" UNIQUE ("domain"),
        CONSTRAINT "FK_workspace_sso_configs_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "workspace_sso_configs"`);
  }
}
