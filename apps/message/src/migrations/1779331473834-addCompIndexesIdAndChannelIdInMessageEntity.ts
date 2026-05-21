import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCompIndexesIdAndChannelIdInMessageEntity1779331473834 implements MigrationInterface {
    name = 'AddCompIndexesIdAndChannelIdInMessageEntity1779331473834'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX "IDX_3ed7a60fb7dbe04e1ba9332a8b" ON "messages" ("channel_id", "id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_3ed7a60fb7dbe04e1ba9332a8b"`);
    }

}
