import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceNotificationObjectUniqueWithDedupeKey1788240000000 implements MigrationInterface {
  name = 'ReplaceNotificationObjectUniqueWithDedupeKey1788240000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "dedupe_key" character varying`,
    );
    await queryRunner.query(`
      UPDATE "notifications"
      SET "dedupe_key" = 'legacy:' || "id"::text
    `);
    await queryRunner.query(
      `ALTER TABLE "notifications" ALTER COLUMN "dedupe_key" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "UQ_notifications_recipient_object"`,
    );
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "UQ_notifications_recipient_dedupe_key"
      UNIQUE ("recipient_id", "dedupe_key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "UQ_notifications_recipient_dedupe_key"`,
    );
    await queryRunner.query(`
      DELETE FROM "notifications" a
      USING "notifications" b
      WHERE a."recipient_id" = b."recipient_id"
        AND a."object_id" = b."object_id"
        AND (a."created_at" > b."created_at" OR (a."created_at" = b."created_at" AND a."id" > b."id"))
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "UQ_notifications_recipient_object"
      UNIQUE ("recipient_id", "object_id")
    `);
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "dedupe_key"`,
    );
  }
}
