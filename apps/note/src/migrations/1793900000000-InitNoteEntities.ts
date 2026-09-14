import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitNoteEntities1793900000000 implements MigrationInterface {
  name = 'InitNoteEntities1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Enums
    await queryRunner.query(
      `CREATE TYPE "public"."pages_type_enum" AS ENUM('Normal', 'Database')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."blocks_type_enum" AS ENUM('text', 'heading', 'bullet', 'numbered_list', 'todo', 'code', 'quote', 'divider', 'image', 'toggle', 'media')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."permissions_type_enum" AS ENUM('view', 'edit')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."views_type_enum" AS ENUM('table', 'board', 'list', 'calendar', 'gallery', 'timeline')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."properties_type_enum" AS ENUM('text', 'select', 'date', 'checkbox', 'number', 'person')`,
    );

    // 2. pages
    await queryRunner.query(`
      CREATE TABLE "pages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "parent_id" uuid,
        "title" character varying(255),
        "favicon" character varying(255),
        "cover_image" character varying(512),
        "type" "public"."pages_type_enum" NOT NULL DEFAULT 'Normal',
        "path" character varying NOT NULL,
        "depth" integer NOT NULL DEFAULT 0,
        "is_public" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_pages" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_PAGES_USER_ID" ON "pages" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_PAGES_WORKSPACE_ID" ON "pages" ("workspace_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_PAGES_PARENT_ID" ON "pages" ("parent_id")`,
    );

    // 3. page_documents
    await queryRunner.query(`
      CREATE TABLE "page_documents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "page_id" uuid NOT NULL,
        "data" bytea NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_page_documents" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_PAGE_DOCUMENTS_PAGE_ID" ON "page_documents" ("page_id")`,
    );

    // 4. blocks
    await queryRunner.query(`
      CREATE TABLE "blocks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "page_id" uuid NOT NULL,
        "type" "public"."blocks_type_enum" NOT NULL,
        "content" jsonb NOT NULL,
        "order" integer NOT NULL,
        "parent_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_blocks" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_BLOCKS_PAGE_ID" ON "blocks" ("page_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_BLOCKS_PARENT_ID" ON "blocks" ("parent_id")`,
    );

    // 5. permissions
    await queryRunner.query(`
      CREATE TABLE "permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "page_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "type" "public"."permissions_type_enum" NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_permissions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_PERMISSIONS_PAGE_ID_USER_ID" ON "permissions" ("page_id", "user_id")`,
    );

    // 6. views
    await queryRunner.query(`
      CREATE TABLE "views" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "page_id" uuid NOT NULL,
        "type" "public"."views_type_enum" NOT NULL,
        "name" character varying(255),
        "config" jsonb NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_views" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_VIEWS_PAGE_ID" ON "views" ("page_id")`,
    );

    // 7. properties
    await queryRunner.query(`
      CREATE TABLE "properties" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "page_id" uuid NOT NULL,
        "name" character varying(255),
        "order" integer NOT NULL,
        "type" "public"."properties_type_enum" NOT NULL,
        "options" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_properties" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_PROPERTIES_PAGE_ID" ON "properties" ("page_id")`,
    );

    // 8. property_values
    await queryRunner.query(`
      CREATE TABLE "property_values" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "page_id" uuid NOT NULL,
        "property_id" uuid NOT NULL,
        "value" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_property_values" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_PROPERTY_VALUES_PAGE_ID_PROPERTY_ID" ON "property_values" ("page_id", "property_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "property_values"`);
    await queryRunner.query(`DROP TABLE "properties"`);
    await queryRunner.query(`DROP TABLE "views"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TABLE "blocks"`);
    await queryRunner.query(`DROP TABLE "page_documents"`);
    await queryRunner.query(`DROP TABLE "pages"`);

    await queryRunner.query(`DROP TYPE "public"."properties_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."views_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."permissions_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."blocks_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."pages_type_enum"`);
  }
}
