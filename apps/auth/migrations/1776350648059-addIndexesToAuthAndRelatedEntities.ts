import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIndexesToAuthAndRelatedEntities1776350648059 implements MigrationInterface {
  name = 'AddIndexesToAuthAndRelatedEntities1776350648059';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_USERS_EMAIL" ON "users" ("email") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SESSION_USER_ID_REVOKED" ON "sessions" ("user_id", "is_revoked") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SESSION_REFRESH_TOKEN_REVOKED" ON "sessions" ("refresh_token", "is_revoked") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_SESSION_REFRESH_TOKEN" ON "sessions" ("refresh_token") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_VERIFICATION_USER_ACTION" ON "verifications" ("user_id", "action") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_VERIFICATION_VERIFY" ON "verifications" ("user_id", "code", "action", "is_used", "expires_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AUTH_USER_PROVIDER" ON "auth" ("user_id", "provider_type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AUTH_USER_ID" ON "auth" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_AUTH_PROVIDER" ON "auth" ("provider_type", "provider_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_AUTH_PROVIDER"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_AUTH_USER_ID"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_AUTH_USER_PROVIDER"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_VERIFICATION_VERIFY"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_VERIFICATION_USER_ACTION"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_SESSION_REFRESH_TOKEN"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_SESSION_REFRESH_TOKEN_REVOKED"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_SESSION_USER_ID_REVOKED"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_USERS_EMAIL"`);
  }
}
