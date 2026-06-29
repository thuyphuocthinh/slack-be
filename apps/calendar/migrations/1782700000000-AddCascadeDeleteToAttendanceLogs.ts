import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCascadeDeleteToAttendanceLogs1782700000000 implements MigrationInterface {
  name = 'AddCascadeDeleteToAttendanceLogs1782700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // attendance_logs.work_shift_id was a raw UUID column with no FK constraint.
    // Add the FK with ON DELETE CASCADE so logs are removed when their shift is deleted.
    await queryRunner.query(`
      ALTER TABLE "attendance_logs"
        ADD CONSTRAINT "FK_attendance_logs_work_shift_id"
        FOREIGN KEY ("work_shift_id")
        REFERENCES "work_shifts"("id")
        ON DELETE CASCADE
        ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "attendance_logs"
        DROP CONSTRAINT "FK_attendance_logs_work_shift_id"
    `);
  }
}
