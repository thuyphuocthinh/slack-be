import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveDeletedAtInWorkspaceEntity1777770778130 implements MigrationInterface {
  name = 'RemoveDeletedAtInWorkspaceEntity1777770778130';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workspaces" DROP COLUMN "deleted_at"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workspaces" ADD "deleted_at" TIMESTAMP`,
    );
  }
}
