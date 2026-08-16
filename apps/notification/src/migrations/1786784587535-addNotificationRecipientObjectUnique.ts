import { MigrationInterface, QueryRunner } from "typeorm";

// notification.md mục 4.2 — chặn bug BullMQ retry (attempts:3, queue.module.ts)
// tạo trùng notification khi CREATE_NOTIFICATION fail giữa chừng rồi tự chạy
// lại từ đầu. Đã verify thật qua load test: 19,134 row trùng lặp tồn tại
// sẵn trong bảng (từ các lần đo tải trước) — phải dọn trước khi add unique
// constraint, nếu không migration sẽ fail vì vi phạm ràng buộc ngay từ đầu.
export class AddNotificationRecipientObjectUnique1786784587535 implements MigrationInterface {
    name = 'AddNotificationRecipientObjectUnique1786784587535'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DELETE FROM "notifications" a
            USING "notifications" b
            WHERE a."recipient_id" = b."recipient_id"
              AND a."object_id" = b."object_id"
              AND (a."created_at" > b."created_at" OR (a."created_at" = b."created_at" AND a."id" > b."id"))
        `);
        await queryRunner.query(`
            ALTER TABLE "notifications"
            ADD CONSTRAINT "UQ_notifications_recipient_object" UNIQUE ("recipient_id", "object_id")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "UQ_notifications_recipient_object"`);
    }
}
