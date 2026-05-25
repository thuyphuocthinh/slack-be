import { MigrationInterface, QueryRunner } from 'typeorm';

export class DenormalizeChannelMember1777383380139 implements MigrationInterface {
  name = 'DenormalizeChannelMember1777383380139';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "channel_members" ADD "email" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_members" ADD "first_name" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_members" ADD "last_name" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_members" ADD "avatar_url" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "channel_members" DROP COLUMN "avatar_url"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_members" DROP COLUMN "last_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_members" DROP COLUMN "first_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_members" DROP COLUMN "email"`,
    );
  }
}
