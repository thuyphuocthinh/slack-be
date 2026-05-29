import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserDeviceEntity1777000000000 implements MigrationInterface {
  name = 'CreateUserDeviceEntity1777000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_devices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(), 
        "user_id" uuid NOT NULL, 
        "device_id" character varying(255) NOT NULL, 
        "user_agent" character varying(255), 
        "ip_address" character varying(45), 
        "is_trusted" boolean NOT NULL DEFAULT false, 
        "last_login_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, 
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, 
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, 
        CONSTRAINT "PK_user_devices_id" PRIMARY KEY ("id")
      )`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_USER_DEVICE" ON "user_devices" ("user_id", "device_id")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_USER_DEVICE"`);
    await queryRunner.query(`DROP TABLE "user_devices"`);
  }
}
