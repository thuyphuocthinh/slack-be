import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrchestrationSkills1785500000000 implements MigrationInterface {
  name = 'CreateOrchestrationSkills1785500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "orchestration_skills" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspace_id" uuid NOT NULL,
        "task_description" text NOT NULL,
        "summary_markdown" text NOT NULL,
        "steps" jsonb NOT NULL,
        "source_checkpoint_ids" jsonb NOT NULL DEFAULT '[]',
        "approved_run_count" int NOT NULL DEFAULT 1,
        "risk_level" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orchestration_skills" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_orchestration_skills_workspace_id" ON "orchestration_skills" ("workspace_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "orchestration_skills"`);
  }
}
