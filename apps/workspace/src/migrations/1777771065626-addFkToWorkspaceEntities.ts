import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFkToWorkspaceEntities1777771065626 implements MigrationInterface {
  name = 'AddFkToWorkspaceEntities1777771065626';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ADD CONSTRAINT "FK_4a7c584ddfe855379598b5e20fd" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_invites" ADD CONSTRAINT "FK_9ffc4e5b893e8fb91d66d466f6d" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_links" ADD CONSTRAINT "FK_2d8d6ef37de35397fd9fd64f44a" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workspace_links" DROP CONSTRAINT "FK_2d8d6ef37de35397fd9fd64f44a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_invites" DROP CONSTRAINT "FK_9ffc4e5b893e8fb91d66d466f6d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" DROP CONSTRAINT "FK_4a7c584ddfe855379598b5e20fd"`,
    );
  }
}
