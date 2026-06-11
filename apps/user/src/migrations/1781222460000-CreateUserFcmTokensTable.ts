import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUserFcmTokensTable1781222460000 implements MigrationInterface {
    name = 'CreateUserFcmTokensTable1781222460000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "user_fcm_tokens" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "user_id" uuid NOT NULL,
                "device_id" character varying(255) NOT NULL,
                "token" text NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_USER_FCM_TOKENS_ID" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_USER_FCM_TOKENS_USER_DEVICE" ON "user_fcm_tokens" ("user_id", "device_id")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX "IDX_USER_FCM_TOKENS_USER_DEVICE"
        `);
        await queryRunner.query(`
            DROP TABLE "user_fcm_tokens"
        `);
    }
}
