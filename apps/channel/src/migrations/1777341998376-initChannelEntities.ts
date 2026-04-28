import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitChannelEntities1777341998376 implements MigrationInterface {
  name = 'InitChannelEntities1777341998376';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "channel_members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel_id" uuid NOT NULL, "member_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "last_read_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_9383bd354ca4f9506de2da24ca1" UNIQUE ("channel_id", "member_id"), CONSTRAINT "PK_95976b619edca48aed364c70c36" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "channels" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "title" character varying NOT NULL, "type" character varying NOT NULL DEFAULT 'group', "description" text, "is_star" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_8f12fee54f4cb360bf355a6580f" UNIQUE ("workspace_id", "title"), CONSTRAINT "PK_bc603823f3f741359c2339389f9" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "channels"`);
    await queryRunner.query(`DROP TABLE "channel_members"`);
  }
}
