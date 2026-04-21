import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDefaultValueWorkspaceLinkType1776699133064 implements MigrationInterface {
  name = 'AddDefaultValueWorkspaceLinkType1776699133064';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workspace_links" ALTER COLUMN "type" SET DEFAULT 'public_invite'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workspace_links" ALTER COLUMN "type" DROP DEFAULT`,
    );
  }
}
