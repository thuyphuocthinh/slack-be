import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIndexChannelIdInChannelMemberEntity1777383162947 implements MigrationInterface {
  name = 'AddIndexChannelIdInChannelMemberEntity1777383162947';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_71a10831469775a1effdd85f24" ON "channel_members" ("channel_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_71a10831469775a1effdd85f24"`,
    );
  }
}
