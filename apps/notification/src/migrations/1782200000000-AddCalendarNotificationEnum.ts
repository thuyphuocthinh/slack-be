import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalendarNotificationEnum1782200000000 implements MigrationInterface {
  name = 'AddCalendarNotificationEnum1782200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Thêm các giá trị mới vào ENUM cho Calendar
    await queryRunner.query(
      `ALTER TYPE "public"."notifications_type_enum" ADD VALUE IF NOT EXISTS 'calendar_request_created'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."notifications_type_enum" ADD VALUE IF NOT EXISTS 'calendar_request_approved'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."notifications_type_enum" ADD VALUE IF NOT EXISTS 'calendar_request_rejected'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL không hỗ trợ DROP VALUE trực tiếp từ ENUM.
    // Nếu muốn rollback, ta phải tạo một Type tạm, copy data sang, drop Type cũ và đổi tên Type mới lại.
    // Tuy nhiên trong thực tế với các ENUM notifications, ta thường có thể để nguyên hoặc implement rollback phức tạp này.
  }
}
