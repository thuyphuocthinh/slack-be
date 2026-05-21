import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRecordingFields1779344085411 implements MigrationInterface {
    name = 'AddRecordingFields1779344085411'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "huddles" ADD "egress_id" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "huddles" ADD "is_recording" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "huddles" ADD "video_record_url" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "huddles" DROP COLUMN "video_record_url"`);
        await queryRunner.query(`ALTER TABLE "huddles" DROP COLUMN "is_recording"`);
        await queryRunner.query(`ALTER TABLE "huddles" DROP COLUMN "egress_id"`);
    }

}
