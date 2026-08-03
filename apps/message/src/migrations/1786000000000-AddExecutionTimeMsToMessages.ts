import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExecutionTimeMsToMessages1786000000000
  implements MigrationInterface
{
  name = 'AddExecutionTimeMsToMessages1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messages" ADD "execution_time_ms" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN "execution_time_ms"`,
    );
  }
}
