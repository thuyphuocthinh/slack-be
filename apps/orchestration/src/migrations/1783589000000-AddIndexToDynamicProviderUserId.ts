import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

export class AddIndexToDynamicProviderUserId1783589000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createIndex(
      'orchestration_dynamic_providers',
      new TableIndex({
        name: 'idx_dyn_prov_user_id',
        columnNames: ['user_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('orchestration_dynamic_providers', 'idx_dyn_prov_user_id');
  }
}
