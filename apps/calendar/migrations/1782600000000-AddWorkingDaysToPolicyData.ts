import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkingDaysToPolicyData1782600000000 implements MigrationInterface {
  name = 'AddWorkingDaysToPolicyData1782600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Backfill workingDays = [1,2,3,4,5] (Mon–Fri) cho các workspace chưa cấu hình
    await queryRunner.query(`
      UPDATE "workspace_calendar_policies"
      SET "policy_data" = "policy_data" || '{"workingDays": [1,2,3,4,5]}'::jsonb
      WHERE NOT ("policy_data" ? 'workingDays')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "workspace_calendar_policies"
      SET "policy_data" = "policy_data" - 'workingDays'
    `);
  }
}
