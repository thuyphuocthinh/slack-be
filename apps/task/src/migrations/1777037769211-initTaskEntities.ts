import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitTaskEntities1777037769211 implements MigrationInterface {
  name = 'InitTaskEntities1777037769211';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "task_checklist_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "checklist_id" uuid NOT NULL, "content" character varying NOT NULL, "is_completed" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_4e4ad2f667e6a79aa843ba5cc8c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_808f8a0063da355c640b846415" ON "task_checklist_items" ("checklist_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "task_checklists" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "task_id" uuid NOT NULL, "name" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_30ed5137470ab484e7f700d4ae3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b63115f9bafae8097c8f8c52f6" ON "task_checklists" ("task_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "task_boards" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" character varying NOT NULL, "background_url" character varying(512) NOT NULL, "name" character varying(100) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d728e71981469064e15dcf51f41" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4d1851ebc4eb8965fb3d431752" ON "task_boards" ("workspace_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "task_groups" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "board_id" uuid NOT NULL, "name" character varying NOT NULL, "order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ade40ef2ca472cf28d4778b0c0c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fc2659d2a2ddb8137b3a5f1336" ON "task_groups" ("board_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "task_labels" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" character varying NOT NULL, "name" character varying NOT NULL, "color" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_72402f2c22ceabc2e73b718c321" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f2dd6dec3cd26a84cb6c737e7c" ON "task_labels" ("workspace_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "task_attachments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "task_id" uuid NOT NULL, "title" character varying(100) NOT NULL, "link" character varying(512) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_34eb9e5133310a488eaba0be28a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8c07320adec50a39744a4a301d" ON "task_attachments" ("task_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "tasks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "group_id" uuid NOT NULL, "title" character varying NOT NULL, "description" text, "due_date" TIMESTAMP, "order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_438e3c81c9f4209c1348366115" ON "tasks" ("group_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "task_members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "task_id" uuid NOT NULL, "member_id" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_10edb4d7be8b37339ee3fc341cd" UNIQUE ("task_id", "member_id"), CONSTRAINT "PK_abb09cdcfbe8bf7bc6686184293" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e3a526efa083bf2d93f28597a8" ON "task_members" ("task_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_78819a9964757ff8b2d0dc5b1e" ON "task_members" ("member_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "task_board_members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "board_id" uuid NOT NULL, "member_id" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_4bc035ec878641006308e02f290" UNIQUE ("board_id", "member_id"), CONSTRAINT "PK_a7bbd6b5aae952d83cd189e3786" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d5ed12779d3d815c1e7db5d12b" ON "task_board_members" ("board_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e52cd75e6a21eb343bc9b426d5" ON "task_board_members" ("member_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "task_label_mapping" ("tasksId" uuid NOT NULL, "taskLabelsId" uuid NOT NULL, CONSTRAINT "PK_0e824b7647fa0f4efe68aca1305" PRIMARY KEY ("tasksId", "taskLabelsId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9c63c4679a645ea5bd0df666c4" ON "task_label_mapping" ("tasksId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8b9348ac0af8b9d14458fa0305" ON "task_label_mapping" ("taskLabelsId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "task_checklist_items" ADD CONSTRAINT "FK_808f8a0063da355c640b8464152" FOREIGN KEY ("checklist_id") REFERENCES "task_checklists"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_checklists" ADD CONSTRAINT "FK_b63115f9bafae8097c8f8c52f66" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_groups" ADD CONSTRAINT "FK_fc2659d2a2ddb8137b3a5f13366" FOREIGN KEY ("board_id") REFERENCES "task_boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_attachments" ADD CONSTRAINT "FK_8c07320adec50a39744a4a301d3" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_438e3c81c9f4209c13483661157" FOREIGN KEY ("group_id") REFERENCES "task_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_members" ADD CONSTRAINT "FK_e3a526efa083bf2d93f28597a85" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_board_members" ADD CONSTRAINT "FK_d5ed12779d3d815c1e7db5d12b9" FOREIGN KEY ("board_id") REFERENCES "task_boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_label_mapping" ADD CONSTRAINT "FK_9c63c4679a645ea5bd0df666c4b" FOREIGN KEY ("tasksId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_label_mapping" ADD CONSTRAINT "FK_8b9348ac0af8b9d14458fa0305e" FOREIGN KEY ("taskLabelsId") REFERENCES "task_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "task_label_mapping" DROP CONSTRAINT "FK_8b9348ac0af8b9d14458fa0305e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_label_mapping" DROP CONSTRAINT "FK_9c63c4679a645ea5bd0df666c4b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_board_members" DROP CONSTRAINT "FK_d5ed12779d3d815c1e7db5d12b9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_members" DROP CONSTRAINT "FK_e3a526efa083bf2d93f28597a85"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT "FK_438e3c81c9f4209c13483661157"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_attachments" DROP CONSTRAINT "FK_8c07320adec50a39744a4a301d3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_groups" DROP CONSTRAINT "FK_fc2659d2a2ddb8137b3a5f13366"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_checklists" DROP CONSTRAINT "FK_b63115f9bafae8097c8f8c52f66"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_checklist_items" DROP CONSTRAINT "FK_808f8a0063da355c640b8464152"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b9348ac0af8b9d14458fa0305"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9c63c4679a645ea5bd0df666c4"`,
    );
    await queryRunner.query(`DROP TABLE "task_label_mapping"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e52cd75e6a21eb343bc9b426d5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5ed12779d3d815c1e7db5d12b"`,
    );
    await queryRunner.query(`DROP TABLE "task_board_members"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_78819a9964757ff8b2d0dc5b1e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e3a526efa083bf2d93f28597a8"`,
    );
    await queryRunner.query(`DROP TABLE "task_members"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_438e3c81c9f4209c1348366115"`,
    );
    await queryRunner.query(`DROP TABLE "tasks"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8c07320adec50a39744a4a301d"`,
    );
    await queryRunner.query(`DROP TABLE "task_attachments"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f2dd6dec3cd26a84cb6c737e7c"`,
    );
    await queryRunner.query(`DROP TABLE "task_labels"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fc2659d2a2ddb8137b3a5f1336"`,
    );
    await queryRunner.query(`DROP TABLE "task_groups"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4d1851ebc4eb8965fb3d431752"`,
    );
    await queryRunner.query(`DROP TABLE "task_boards"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b63115f9bafae8097c8f8c52f6"`,
    );
    await queryRunner.query(`DROP TABLE "task_checklists"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_808f8a0063da355c640b846415"`,
    );
    await queryRunner.query(`DROP TABLE "task_checklist_items"`);
  }
}
