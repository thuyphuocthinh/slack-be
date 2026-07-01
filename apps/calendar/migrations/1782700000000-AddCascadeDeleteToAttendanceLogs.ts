import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCascadeDeleteToAttendanceLogs1782700000000 implements MigrationInterface {
  name = 'AddCascadeDeleteToAttendanceLogs1782700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop first in case a prior migration or synchronize already created this FK
    // without ON DELETE CASCADE, then re-add with the correct behaviour.
    await queryRunner.query(`
      ALTER TABLE "attendance_logs"
        DROP CONSTRAINT IF EXISTS "FK_attendance_logs_work_shift_id"
    `);
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
