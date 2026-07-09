import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAuthFieldsToDynamicProvider1783588900000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('orchestration_dynamic_providers', [
      new TableColumn({
        name: 'auth_type',
        type: 'varchar',
        length: '50',
        default: "'BEARER'",
      }),
      new TableColumn({
        name: 'refresh_token',
        type: 'text',
        isNullable: true,
      }),
      new TableColumn({
        name: 'token_expires_at',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'auth_config',
        type: 'jsonb',
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('orchestration_dynamic_providers', [
      'auth_type',
      'refresh_token',
      'token_expires_at',
      'auth_config',
    ]);
  }
}
