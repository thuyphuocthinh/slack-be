import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixVerificationTimezone1777000000001 implements MigrationInterface {
  name = 'FixVerificationTimezone1777000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "verifications" ALTER COLUMN "expires_at" TYPE TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "verifications" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "verifications" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "verifications" ALTER COLUMN "expires_at" TYPE TIMESTAMP WITHOUT TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "verifications" ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "verifications" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE`);
  }
}
