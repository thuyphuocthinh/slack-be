import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitCalendarEntities1781800000000 implements MigrationInterface {
  name = 'InitCalendarEntities1781800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create Enums
    await queryRunner.query(`CREATE TYPE "public"."calendar_request_type_enum" AS ENUM('LEAVE_PAID', 'LEAVE_UNPAID', 'LEAVE_SICK', 'OFF_SHIFT', 'CALENDAR_OPEN_REQUEST', 'ATTENDANCE_CORRECTION')`);
    await queryRunner.query(`CREATE TYPE "public"."calendar_request_status_enum" AS ENUM('PENDING', 'APPROVED', 'REJECTED')`);
    await queryRunner.query(`CREATE TYPE "public"."work_shift_type_enum" AS ENUM('FULLTIME', 'PARTTIME')`);
    await queryRunner.query(`CREATE TYPE "public"."work_shift_location_enum" AS ENUM('OFFICE', 'WFH')`);
    await queryRunner.query(`CREATE TYPE "public"."work_shift_status_enum" AS ENUM('PENDING', 'APPROVED', 'REJECTED')`);
    await queryRunner.query(`CREATE TYPE "public"."attendance_log_type_enum" AS ENUM('CHECK_IN', 'CHECK_OUT')`);
    await queryRunner.query(`CREATE TYPE "public"."daily_reconciliation_status_enum" AS ENUM('NORMAL', 'LATE_EARLY', 'ABSENT', 'LEAVE_PAID_APPROVED', 'LEAVE_UNPAID_APPROVED')`);

    // 2. Create Tables
    await queryRunner.query(`
      CREATE TABLE "workspace_calendar_policies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspace_id" uuid NOT NULL,
        "policy_data" jsonb NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_workspace_calendar_policies_workspace_id" UNIQUE ("workspace_id"),
        CONSTRAINT "PK_workspace_calendar_policies" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "work_shifts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "work_date" date NOT NULL,
        "shift_type" "public"."work_shift_type_enum" NOT NULL DEFAULT 'FULLTIME',
        "location" "public"."work_shift_location_enum" NOT NULL DEFAULT 'OFFICE',
        "start_time" TIMESTAMP WITH TIME ZONE NOT NULL,
        "end_time" TIMESTAMP WITH TIME ZONE NOT NULL,
        "status" "public"."work_shift_status_enum" NOT NULL DEFAULT 'APPROVED',
        "approved_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_work_shifts_user_workspace_date" UNIQUE ("user_id", "workspace_id", "work_date"),
        CONSTRAINT "PK_work_shifts" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "calendar_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "request_type" "public"."calendar_request_type_enum" NOT NULL,
        "start_time" TIMESTAMP WITH TIME ZONE NOT NULL,
        "end_time" TIMESTAMP WITH TIME ZONE NOT NULL,
        "duration_days" real NOT NULL DEFAULT 1.0,
        "reason" text NOT NULL,
        "status" "public"."calendar_request_status_enum" NOT NULL DEFAULT 'PENDING',
        "approved_by" uuid,
        "reject_reason" text,
        "notes" text,
        "meta_data" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_calendar_requests" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "attendance_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "work_shift_id" uuid,
        "log_type" "public"."attendance_log_type_enum" NOT NULL,
        "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "ip_address" character varying,
        "face_image_key" text,
        "face_similarity_score" real,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attendance_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "daily_reconciliations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "work_shift_id" uuid,
        "work_date" date NOT NULL,
        "first_check_in" TIMESTAMP WITH TIME ZONE,
        "last_check_out" TIMESTAMP WITH TIME ZONE,
        "actual_work_hours" real NOT NULL DEFAULT 0.0,
        "standard_work_hours" real NOT NULL DEFAULT 0.0,
        "late_minutes" integer NOT NULL DEFAULT 0,
        "early_leave_minutes" integer NOT NULL DEFAULT 0,
        "status" "public"."daily_reconciliation_status_enum" NOT NULL DEFAULT 'ABSENT',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_daily_reconciliations_user_workspace_date" UNIQUE ("user_id", "workspace_id", "work_date"),
        CONSTRAINT "PK_daily_reconciliations" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "leave_balances" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "year" integer NOT NULL,
        "total_paid_leave" real NOT NULL DEFAULT 12,
        "used_paid_leave" real NOT NULL DEFAULT 0,
        "used_sick_leave" real NOT NULL DEFAULT 0,
        "used_unpaid_leave" real NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_leave_balances_user_workspace_year" UNIQUE ("user_id", "workspace_id", "year"),
        CONSTRAINT "PK_leave_balances" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "user_face_baselines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "face_baseline_key" text NOT NULL,
        "face_descriptor" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_user_face_baselines_user_workspace" UNIQUE ("user_id", "workspace_id"),
        CONSTRAINT "PK_user_face_baselines" PRIMARY KEY ("id")
      )
    `);

    // 3. Create Indexes
    await queryRunner.query(`CREATE INDEX "IDX_work_shifts_user_id" ON "work_shifts" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_work_shifts_workspace_id" ON "work_shifts" ("workspace_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_work_shifts_work_date" ON "work_shifts" ("work_date")`);

    await queryRunner.query(`CREATE INDEX "IDX_calendar_requests_user_id" ON "calendar_requests" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_calendar_requests_workspace_id" ON "calendar_requests" ("workspace_id")`);

    await queryRunner.query(`CREATE INDEX "IDX_attendance_logs_user_id" ON "attendance_logs" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_attendance_logs_workspace_id" ON "attendance_logs" ("workspace_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_attendance_logs_work_shift_id" ON "attendance_logs" ("work_shift_id")`);

    await queryRunner.query(`CREATE INDEX "IDX_daily_reconciliations_user_id" ON "daily_reconciliations" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_daily_reconciliations_workspace_id" ON "daily_reconciliations" ("workspace_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_daily_reconciliations_work_shift_id" ON "daily_reconciliations" ("work_shift_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_daily_reconciliations_work_date" ON "daily_reconciliations" ("work_date")`);

    await queryRunner.query(`CREATE INDEX "IDX_leave_balances_user_id" ON "leave_balances" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_leave_balances_workspace_id" ON "leave_balances" ("workspace_id")`);

    await queryRunner.query(`CREATE INDEX "IDX_user_face_baselines_user_id" ON "user_face_baselines" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_user_face_baselines_workspace_id" ON "user_face_baselines" ("workspace_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_face_baselines"`);
    await queryRunner.query(`DROP TABLE "leave_balances"`);
    await queryRunner.query(`DROP TABLE "daily_reconciliations"`);
    await queryRunner.query(`DROP TABLE "attendance_logs"`);
    await queryRunner.query(`DROP TABLE "calendar_requests"`);
    await queryRunner.query(`DROP TABLE "work_shifts"`);
    await queryRunner.query(`DROP TABLE "workspace_calendar_policies"`);

    await queryRunner.query(`DROP TYPE "public"."daily_reconciliation_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."attendance_log_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."work_shift_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."work_shift_location_enum"`);
    await queryRunner.query(`DROP TYPE "public"."work_shift_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."calendar_request_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."calendar_request_type_enum"`);
  }
}
