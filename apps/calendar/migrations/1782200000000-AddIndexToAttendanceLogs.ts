import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIndexToAttendanceLogs1782200000000 implements MigrationInterface {
  name = 'AddIndexToAttendanceLogs1782200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_attendance_logs_recent" ON "attendance_logs" ("workspace_id", "user_id", "log_type", "recorded_at")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_attendance_logs_recent"`);
  }
}
