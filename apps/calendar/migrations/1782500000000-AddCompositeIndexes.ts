import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompositeIndexes1782500000000 implements MigrationInterface {
  name = 'AddCompositeIndexes1782500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // work_shifts: resolveShift (check-in/out) và leave approval find-shifts
    await queryRunner.query(
      `CREATE INDEX "IDX_WORK_SHIFT_WS_USER_DATE" ON "work_shifts" ("workspace_id", "user_id", "work_date")`
    );

    // work_shifts: cron dailyReconciliation (query toàn bộ shifts theo ngày)
    await queryRunner.query(
      `CREATE INDEX "IDX_WORK_SHIFT_DATE_WS" ON "work_shifts" ("work_date", "workspace_id")`
    );

    // attendance_logs: getLatestLog (check-in/out path) — filter by shift, sort by recordedAt DESC
    await queryRunner.query(
      `CREATE INDEX "IDX_ATTENDANCE_LOG_SHIFT_RECENT" ON "attendance_logs" ("workspace_id", "user_id", "work_shift_id", "recorded_at")`
    );

    // calendar_requests: getRequests với filter status + sort createdAt
    await queryRunner.query(
      `CREATE INDEX "IDX_CALENDAR_REQ_WS_USER_STATUS" ON "calendar_requests" ("workspace_id", "user_id", "status", "created_at")`
    );

    // calendar_requests: checkOverlappingRequest (range query trên startTime/endTime)
    await queryRunner.query(
      `CREATE INDEX "IDX_CALENDAR_REQ_WS_USER_TIME" ON "calendar_requests" ("workspace_id", "user_id", "start_time", "end_time")`
    );

    // calendar_user_locks: cleanupExpiredLocks cron (LessThan query trên unlockExpiresAt)
    await queryRunner.query(
      `CREATE INDEX "IDX_LOCK_EXPIRES_AT" ON "calendar_user_locks" ("unlock_expires_at")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_LOCK_EXPIRES_AT"`);
    await queryRunner.query(`DROP INDEX "IDX_CALENDAR_REQ_WS_USER_TIME"`);
    await queryRunner.query(`DROP INDEX "IDX_CALENDAR_REQ_WS_USER_STATUS"`);
    await queryRunner.query(`DROP INDEX "IDX_ATTENDANCE_LOG_SHIFT_RECENT"`);
    await queryRunner.query(`DROP INDEX "IDX_WORK_SHIFT_DATE_WS"`);
    await queryRunner.query(`DROP INDEX "IDX_WORK_SHIFT_WS_USER_DATE"`);
  }
}
