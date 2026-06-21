import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotesToWorkShifts1782000000000 implements MigrationInterface {
  name = 'AddNotesToWorkShifts1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "work_shifts" ADD "notes" text`);
    
    // Add foreign key constraint for attendance_logs if it doesn't exist
    // (Note: The column work_shift_id already existed, but we added @ManyToOne relation)
    await queryRunner.query(`ALTER TABLE "attendance_logs" ADD CONSTRAINT "FK_attendance_logs_work_shift_id" FOREIGN KEY ("work_shift_id") REFERENCES "work_shifts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "attendance_logs" DROP CONSTRAINT "FK_attendance_logs_work_shift_id"`);
    await queryRunner.query(`ALTER TABLE "work_shifts" DROP COLUMN "notes"`);
  }
}
