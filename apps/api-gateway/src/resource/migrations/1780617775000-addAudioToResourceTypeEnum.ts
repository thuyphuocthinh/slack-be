import { MigrationInterface, QueryRunner } from "typeorm";

export class addAudioToResourceTypeEnum1780617775000 implements MigrationInterface {
    name = 'addAudioToResourceTypeEnum1780617775000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Thêm giá trị 'audio' vào enum resources_type_enum nếu chưa tồn tại
        await queryRunner.query(`ALTER TYPE "public"."resources_type_enum" ADD VALUE IF NOT EXISTS 'audio'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // PostgreSQL không hỗ trợ lệnh DROP VALUE trong ENUM trực tiếp.
        // Nếu muốn xoá 'audio', phải tạo type mới, chuyển data qua và drop type cũ.
        // Để an toàn, hàm down này sẽ để trống.
    }
}
