import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCancelledCalendarStatus1782220000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."calendar_requests_status_enum" ADD VALUE IF NOT EXISTS 'CANCELLED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL doesn't support DROP VALUE from enum directly
  }
}
