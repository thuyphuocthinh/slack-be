import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCanvasTable1717657200000 implements MigrationInterface {
  name = 'CreateCanvasTable1717657200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "canvases" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "channelId" uuid,
        "contentState" bytea,
        "contentJson" jsonb,
        "updatedBy" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_canvases_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_canvases_channelId" ON "canvases" ("channelId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_canvases_channelId"`);
    await queryRunner.query(`DROP TABLE "canvases"`);
  }
}
