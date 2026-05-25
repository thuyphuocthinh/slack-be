import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMessageAttachmentEntity1778377232843 implements MigrationInterface {
    name = 'AddMessageAttachmentEntity1778377232843'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "message_attachments" ("id" uuid NOT NULL, "message_id" uuid NOT NULL, "resource_id" uuid NOT NULL, "public_id" character varying NOT NULL, "url" character varying NOT NULL, "filename" character varying NOT NULL, "mime_type" character varying NOT NULL, "size" integer NOT NULL, "type" character varying NOT NULL, "thumbnail_url" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e5085d973567c61e9306f10f95b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_bf65c3db8657cef6197b68b8c8" ON "message_attachments" ("message_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_41a566d70088f3e50176870745" ON "message_attachments" ("resource_id") `);
        await queryRunner.query(`ALTER TABLE "message_attachments" ADD CONSTRAINT "FK_bf65c3db8657cef6197b68b8c88" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "message_attachments" DROP CONSTRAINT "FK_bf65c3db8657cef6197b68b8c88"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_41a566d70088f3e50176870745"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bf65c3db8657cef6197b68b8c8"`);
        await queryRunner.query(`DROP TABLE "message_attachments"`);
    }

}
