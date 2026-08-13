import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRiskLevelToOrchestrationCheckpoints1785400000000 implements MigrationInterface {
  name = 'AddRiskLevelToOrchestrationCheckpoints1785400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" ADD COLUMN "risk_level" VARCHAR`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orchestration_checkpoints" DROP COLUMN "risk_level"`,
    );
  }
}
