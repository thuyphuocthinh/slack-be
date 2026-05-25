import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVersionColumnToAttachmentAndTaskMember1777770709784 implements MigrationInterface {
  name = 'AddVersionColumnToAttachmentAndTaskMember1777770709784';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "task_attachments" ADD "version" integer NOT NULL DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_members" ADD "version" integer NOT NULL DEFAULT '1'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "task_members" DROP COLUMN "version"`);
    await queryRunner.query(
      `ALTER TABLE "task_attachments" DROP COLUMN "version"`,
    );
  }
}
