import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddDescriptionToDynamicProvider1783000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'orchestration_dynamic_providers',
      new TableColumn({
        name: 'description',
        type: 'text',
        isNullable: true,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('orchestration_dynamic_providers', 'description');
  }
}
