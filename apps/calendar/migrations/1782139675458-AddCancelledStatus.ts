import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCancelledStatus1782139675458 implements MigrationInterface {
    name = 'AddCancelledStatus1782139675458'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Tên thực tế ở dưới Database hiện tại là "calendar_request_status_enum" (không có chữ s)
        await queryRunner.query(`ALTER TYPE "public"."calendar_request_status_enum" ADD VALUE IF NOT EXISTS 'CANCELLED'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // PostgreSQL không hỗ trợ DROP VALUE trực tiếp từ ENUM
    }
}
