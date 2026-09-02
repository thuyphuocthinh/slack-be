import { MigrationInterface, QueryRunner } from 'typeorm';

export class OptimizeCalendarAdminIndexes1788320000000 implements MigrationInterface {
  name = 'OptimizeCalendarAdminIndexes1788320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_USER_LOCK"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_USER_LOCK"
      ON "calendar_user_locks" ("workspace_id", "target_month", "user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_CALENDAR_REQ_WS_STATUS_CREATED"
      ON "calendar_requests" ("workspace_id", "status", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_CALENDAR_REQ_WS_USER_CREATED"
      ON "calendar_requests" ("workspace_id", "user_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_ATTENDANCE_LOG_SHIFT_RECORDED"
      ON "attendance_logs" ("work_shift_id", "recorded_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_ATTENDANCE_LOG_SHIFT_RECORDED"`);
    await queryRunner.query(`DROP INDEX "IDX_CALENDAR_REQ_WS_USER_CREATED"`);
    await queryRunner.query(`DROP INDEX "IDX_CALENDAR_REQ_WS_STATUS_CREATED"`);
    await queryRunner.query(`DROP INDEX "IDX_USER_LOCK"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_USER_LOCK"
      ON "calendar_user_locks" ("user_id", "workspace_id", "target_month")
    `);
  }
}
