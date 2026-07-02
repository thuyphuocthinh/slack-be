import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsBotToUsers1782886689843 implements MigrationInterface {
  name = 'AddIsBotToUsers1782886689843';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "is_bot" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_bot"`);
  }
}
