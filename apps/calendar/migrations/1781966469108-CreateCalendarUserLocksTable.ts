import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCalendarUserLocksTable1781966469108 implements MigrationInterface {
  name = 'CreateCalendarUserLocksTable1781966469108';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "calendar_user_locks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "target_month" varchar(7) NOT NULL,
        "is_unlocked" boolean NOT NULL DEFAULT false,
        "unlocked_by" uuid,
        "unlock_reason" text,
        "unlock_expires_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_calendar_user_locks" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_USER_LOCK" ON "calendar_user_locks" ("user_id", "workspace_id", "target_month")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "calendar_user_locks"`);
  }
}
