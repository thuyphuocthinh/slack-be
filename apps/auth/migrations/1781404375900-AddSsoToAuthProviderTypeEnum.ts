import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSsoToAuthProviderTypeEnum1781404375900 implements MigrationInterface {
  name = 'AddSsoToAuthProviderTypeEnum1781404375900';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."auth_provider_type_enum" ADD VALUE IF NOT EXISTS 'sso'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Note: PostgreSQL does not support removing values from an ENUM type in a transaction.
  }
}
