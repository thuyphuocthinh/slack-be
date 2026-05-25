import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeLabelToBoardAssociation1777038756577 implements MigrationInterface {
  name = 'ChangeLabelToBoardAssociation1777038756577';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f2dd6dec3cd26a84cb6c737e7c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_labels" RENAME COLUMN "workspace_id" TO "board_id"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f280d011422ec189a07aba0fd" ON "task_labels" ("board_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f280d011422ec189a07aba0fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_labels" RENAME COLUMN "board_id" TO "workspace_id"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f2dd6dec3cd26a84cb6c737e7c" ON "task_labels" ("workspace_id") `,
    );
  }
}
