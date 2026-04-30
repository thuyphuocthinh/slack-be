import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitMessageEntities1777534343493 implements MigrationInterface {
  name = 'InitMessageEntities1777534343493';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "message_mentions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "message_id" uuid NOT NULL, "user_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6d3047d9fb0dd841366be90fb87" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "messages" ("id" uuid NOT NULL, "channel_id" uuid NOT NULL, "user_id" uuid NOT NULL, "content" jsonb NOT NULL, "is_pinned" boolean NOT NULL DEFAULT false, "parent_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_86b9109b155eb70c0a2ca3b4b6" ON "messages" ("channel_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_830a3c1d92614d1495418c4673" ON "messages" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_932abe146b78bd584b4d1851ce" ON "messages" ("parent_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "message_reactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "message_id" uuid NOT NULL, "user_id" uuid NOT NULL, "emoji" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_f5a1f46b4f33ce416f9c192ab29" UNIQUE ("message_id", "user_id", "emoji"), CONSTRAINT "PK_654a9f0059ff93a8f156be66a5b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_mentions" ADD CONSTRAINT "FK_704c2dc52c37d26393dae070253" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_932abe146b78bd584b4d1851ce3" FOREIGN KEY ("parent_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_reactions" ADD CONSTRAINT "FK_ce61e365d81a9dfc15cd36513b0" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message_reactions" DROP CONSTRAINT "FK_ce61e365d81a9dfc15cd36513b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_932abe146b78bd584b4d1851ce3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_mentions" DROP CONSTRAINT "FK_704c2dc52c37d26393dae070253"`,
    );
    await queryRunner.query(`DROP TABLE "message_reactions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_932abe146b78bd584b4d1851ce"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_830a3c1d92614d1495418c4673"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_86b9109b155eb70c0a2ca3b4b6"`,
    );
    await queryRunner.query(`DROP TABLE "messages"`);
    await queryRunner.query(`DROP TABLE "message_mentions"`);
  }
}
