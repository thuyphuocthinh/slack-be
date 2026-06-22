import { MigrationInterface, QueryRunner } from "typeorm";

export class DropUniqueShiftConstraint1782104386218 implements MigrationInterface {
    name = 'DropUniqueShiftConstraint1782104386218'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Sạch sẽ, chỉ xóa đúng thằng gây họa!
        await queryRunner.query(`ALTER TABLE "work_shifts" DROP CONSTRAINT IF EXISTS "UQ_work_shifts_user_workspace_date"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "work_shifts" ADD CONSTRAINT "UQ_work_shifts_user_workspace_date" UNIQUE ("user_id", "workspace_id", "work_date")`);
    }

}
