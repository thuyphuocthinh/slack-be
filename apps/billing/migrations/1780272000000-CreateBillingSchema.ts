import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBillingSchema1780272000000 implements MigrationInterface {
  name = 'CreateBillingSchema1780272000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Thêm stripe_customer_id vào bảng users
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "stripe_customer_id" character varying(255)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_USERS_STRIPE_CUSTOMER_ID" ON "users" ("stripe_customer_id") WHERE "stripe_customer_id" IS NOT NULL`,
    );

    // 2. Enum interval cho pricing_plans
    await queryRunner.query(
      `CREATE TYPE "public"."pricing_plans_interval_enum" AS ENUM('month', 'year')`,
    );

    // 3. Bảng pricing_plans
    await queryRunner.query(
      `CREATE TABLE "pricing_plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(100) NOT NULL,
        "stripe_product_id" character varying(255) NOT NULL,
        "stripe_price_id" character varying(255) NOT NULL,
        "price" numeric(10,2) NOT NULL,
        "currency" character varying(10) NOT NULL,
        "interval" "public"."pricing_plans_interval_enum" NOT NULL,
        "features" jsonb NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_pricing_plans_name" UNIQUE ("name"),
        CONSTRAINT "UQ_pricing_plans_stripe_product_id" UNIQUE ("stripe_product_id"),
        CONSTRAINT "UQ_pricing_plans_stripe_price_id" UNIQUE ("stripe_price_id"),
        CONSTRAINT "PK_pricing_plans" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_PRICING_PLANS_STRIPE_PRICE_ID" ON "pricing_plans" ("stripe_price_id")`,
    );

    // 4. Enum status cho user_subscriptions
    await queryRunner.query(
      `CREATE TYPE "public"."user_subscriptions_status_enum" AS ENUM('active', 'past_due', 'canceled', 'unpaid', 'trialing')`,
    );

    // 5. Bảng user_subscriptions — UNIQUE(user_id): 1 user = 1 subscription
    await queryRunner.query(
      `CREATE TABLE "user_subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "plan_id" uuid NOT NULL,
        "stripe_subscription_id" character varying(255),
        "status" "public"."user_subscriptions_status_enum" NOT NULL DEFAULT 'active',
        "current_period_start" TIMESTAMP WITH TIME ZONE NOT NULL,
        "current_period_end" TIMESTAMP WITH TIME ZONE NOT NULL,
        "cancel_at_period_end" boolean NOT NULL DEFAULT false,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "UQ_user_subscriptions_user_id" UNIQUE ("user_id"),
        CONSTRAINT "UQ_user_subscriptions_stripe_sub_id" UNIQUE ("stripe_subscription_id"),
        CONSTRAINT "PK_user_subscriptions" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_USER_SUBSCRIPTIONS_USER_ID" ON "user_subscriptions" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_USER_SUBSCRIPTIONS_STATUS" ON "user_subscriptions" ("status")`,
    );

    // 6. Enum status cho invoices
    await queryRunner.query(
      `CREATE TYPE "public"."invoices_status_enum" AS ENUM('draft', 'open', 'paid', 'uncollectible', 'void')`,
    );

    // 7. Bảng invoices
    await queryRunner.query(
      `CREATE TABLE "invoices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "stripe_invoice_id" character varying(255) NOT NULL,
        "amount_due" numeric(10,2) NOT NULL,
        "amount_paid" numeric(10,2) NOT NULL,
        "status" "public"."invoices_status_enum" NOT NULL,
        "hosted_invoice_url" character varying(512),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_invoices_stripe_invoice_id" UNIQUE ("stripe_invoice_id"),
        CONSTRAINT "PK_invoices" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_INVOICES_USER_ID" ON "invoices" ("user_id")`,
    );

    // 8. Bảng processed_stripe_events — Idempotency table
    await queryRunner.query(
      `CREATE TABLE "processed_stripe_events" (
        "event_id" character varying(255) NOT NULL,
        "event_type" character varying(100) NOT NULL,
        "processed_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_processed_stripe_events" PRIMARY KEY ("event_id")
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "processed_stripe_events"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_INVOICES_USER_ID"`);
    await queryRunner.query(`DROP TABLE "invoices"`);
    await queryRunner.query(`DROP TYPE "public"."invoices_status_enum"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_USER_SUBSCRIPTIONS_STATUS"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_USER_SUBSCRIPTIONS_USER_ID"`);
    await queryRunner.query(`DROP TABLE "user_subscriptions"`);
    await queryRunner.query(`DROP TYPE "public"."user_subscriptions_status_enum"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_PRICING_PLANS_STRIPE_PRICE_ID"`);
    await queryRunner.query(`DROP TABLE "pricing_plans"`);
    await queryRunner.query(`DROP TYPE "public"."pricing_plans_interval_enum"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_USERS_STRIPE_CUSTOMER_ID"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "stripe_customer_id"`);
  }
}
