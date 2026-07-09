import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDynamicProvidersTable1783000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "orchestration_dynamic_providers" (
        "id" character varying NOT NULL,
        "user_id" character varying NOT NULL,
        "name" character varying NOT NULL,
        "spec_url" text NOT NULL,
        "api_key" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orchestration_dynamic_providers" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "orchestration_dynamic_providers"`);
  }
}
