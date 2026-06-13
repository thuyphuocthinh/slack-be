import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateLinkPreviewsTable1780100000000 implements MigrationInterface {
    name = 'CreateLinkPreviewsTable1780100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "link_previews" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "url_hash" character varying(64) NOT NULL,
                "url" text NOT NULL,
                "title" character varying(255),
                "description" text,
                "image_url" text,
                "site_name" character varying(100),
                "fav_icon" text,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_link_previews_id" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_link_previews_url_hash" UNIQUE ("url_hash")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_link_previews_url_hash" ON "link_previews" ("url_hash")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_link_previews_url_hash"`);
        await queryRunner.query(`DROP TABLE "link_previews"`);
    }
}
