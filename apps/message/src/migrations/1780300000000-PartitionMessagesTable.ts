import { MigrationInterface, QueryRunner } from 'typeorm';

export class PartitionMessagesTable1780300000000 implements MigrationInterface {
  name = 'PartitionMessagesTable1780300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop existing foreign keys referencing messages
    await queryRunner.query(
      `ALTER TABLE "message_reactions" DROP CONSTRAINT IF EXISTS "FK_ce61e365d81a9dfc15cd36513b0"`
    );
    await queryRunner.query(
      `ALTER TABLE "message_mentions" DROP CONSTRAINT IF EXISTS "FK_704c2dc52c37d26393dae070253"`
    );
    await queryRunner.query(
      `ALTER TABLE "message_attachments" DROP CONSTRAINT IF EXISTS "FK_bf65c3db8657cef6197b68b8c88"`
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "FK_932abe146b78bd584b4d1851ce3"`
    );

    // 2. Rename existing messages table to keep data safe
    await queryRunner.query(`ALTER TABLE "messages" RENAME TO "messages_old"`);

    // 3. Create the new partitioned messages table
    // PostgreSQL requires the partition key (created_at) to be part of the primary key
    await queryRunner.query(`
      CREATE TABLE "messages" (
        "id" uuid NOT NULL,
        "channel_id" uuid NOT NULL,
        "user_id" uuid,
        "webhook_id" uuid,
        "custom_name" character varying,
        "custom_avatar_url" character varying,
        "content" jsonb NOT NULL,
        "is_pinned" boolean NOT NULL DEFAULT false,
        "parent_id" uuid,
        "link_previews" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_messages_id_created_at" PRIMARY KEY ("id", "created_at")
      ) PARTITION BY RANGE ("created_at")
    `);

    // 4. Create partition tables
    // A default partition to safely catch any dates outside defined ranges
    await queryRunner.query(
      `CREATE TABLE "messages_default" PARTITION OF "messages" DEFAULT`
    );

    // Specific partitions for year 2026 (Quarters)
    await queryRunner.query(
      `CREATE TABLE "messages_y2026_q1" PARTITION OF "messages" FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2026-04-01 00:00:00+00')`
    );
    await queryRunner.query(
      `CREATE TABLE "messages_y2026_q2" PARTITION OF "messages" FOR VALUES FROM ('2026-04-01 00:00:00+00') TO ('2026-07-01 00:00:00+00')`
    );
    await queryRunner.query(
      `CREATE TABLE "messages_y2026_q3" PARTITION OF "messages" FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-10-01 00:00:00+00')`
    );
    await queryRunner.query(
      `CREATE TABLE "messages_y2026_q4" PARTITION OF "messages" FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2027-01-01 00:00:00+00')`
    );

    // Specific partition for year 2027
    await queryRunner.query(
      `CREATE TABLE "messages_y2027" PARTITION OF "messages" FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2028-01-01 00:00:00+00')`
    );

    // 5. Migrate data from old table to new partitioned table
    await queryRunner.query(`
      INSERT INTO "messages" (
        "id", "channel_id", "user_id", "webhook_id", "custom_name", "custom_avatar_url", 
        "content", "is_pinned", "parent_id", "link_previews", "created_at", "updated_at"
      )
      SELECT 
        "id", "channel_id", "user_id", "webhook_id", "custom_name", "custom_avatar_url", 
        "content", "is_pinned", "parent_id", "link_previews", "created_at", "updated_at" 
      FROM "messages_old"
    `);

    // 6. Create Indexes on the partitioned table
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_channel_id" ON "messages" ("channel_id")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_user_id" ON "messages" ("user_id")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_parent_id" ON "messages" ("parent_id")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_channel_id_id" ON "messages" ("channel_id", "id")`
    );

    // 7. Drop old table
    await queryRunner.query(`DROP TABLE "messages_old"`);

    // 8. Create Function and Trigger to handle Cascade Delete on database level
    // Since we removed physical foreign key constraints to support partitioning without altering child tables,
    // we use a database trigger to automatically delete related rows when a message is deleted.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION delete_message_dependencies()
      RETURNS TRIGGER AS $$
      BEGIN
          DELETE FROM "message_reactions" WHERE "message_id" = OLD.id;
          DELETE FROM "message_mentions" WHERE "message_id" = OLD.id;
          DELETE FROM "message_attachments" WHERE "message_id" = OLD.id;
          DELETE FROM "messages" WHERE "parent_id" = OLD.id;
          RETURN OLD;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trigger_delete_message_dependencies
      BEFORE DELETE ON "messages"
      FOR EACH ROW
      EXECUTE FUNCTION delete_message_dependencies();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop trigger and function
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trigger_delete_message_dependencies ON "messages"`
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS delete_message_dependencies()`
    );

    // 2. Rename partitioned messages table
    await queryRunner.query(`ALTER TABLE "messages" RENAME TO "messages_old"`);

    // 3. Re-create the original non-partitioned messages table
    await queryRunner.query(`
      CREATE TABLE "messages" (
        "id" uuid NOT NULL,
        "channel_id" uuid NOT NULL,
        "user_id" uuid,
        "webhook_id" uuid,
        "custom_name" character varying,
        "custom_avatar_url" character varying,
        "content" jsonb NOT NULL,
        "is_pinned" boolean NOT NULL DEFAULT false,
        "parent_id" uuid,
        "link_previews" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id")
      )
    `);

    // 4. Migrate data back
    await queryRunner.query(`
      INSERT INTO "messages" (
        "id", "channel_id", "user_id", "webhook_id", "custom_name", "custom_avatar_url", 
        "content", "is_pinned", "parent_id", "link_previews", "created_at", "updated_at"
      )
      SELECT 
        "id", "channel_id", "user_id", "webhook_id", "custom_name", "custom_avatar_url", 
        "content", "is_pinned", "parent_id", "link_previews", "created_at", "updated_at" 
      FROM "messages_old"
    `);

    // 5. Re-create indices
    await queryRunner.query(
      `CREATE INDEX "IDX_86b9109b155eb70c0a2ca3b4b6" ON "messages" ("channel_id")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_830a3c1d92614d1495418c4673" ON "messages" ("user_id")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_932abe146b78bd584b4d1851ce" ON "messages" ("parent_id")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3ed7a60fb7dbe04e1ba9332a8b" ON "messages" ("channel_id", "id")`
    );

    // 6. Drop the partitioned tables (cascades to partition tables)
    await queryRunner.query(`DROP TABLE "messages_old" CASCADE`);

    // 7. Re-create the physical foreign key constraints
    await queryRunner.query(
      `ALTER TABLE "message_mentions" ADD CONSTRAINT "FK_704c2dc52c37d26393dae070253" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_932abe146b78bd584b4d1851ce3" FOREIGN KEY ("parent_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "message_reactions" ADD CONSTRAINT "FK_ce61e365d81a9dfc15cd36513b0" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "message_attachments" ADD CONSTRAINT "FK_bf65c3db8657cef6197b68b8c88" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }
}
