import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameApiKeyToAccessToken1783589100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.renameColumn('orchestration_dynamic_providers', 'api_key', 'access_token');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.renameColumn('orchestration_dynamic_providers', 'access_token', 'api_key');
  }
}
