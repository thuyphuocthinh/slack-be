import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@slack/database';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { InvoiceEntity } from './entity/invoice.entity';
import { PricingPlanEntity } from './entity/pricing-plan.entity';
import { ProcessedStripeEventEntity } from './entity/processed-stripe-event.entity';
import { UserSubscriptionEntity } from './entity/user-subscription.entity';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      PricingPlanEntity,
      UserSubscriptionEntity,
      InvoiceEntity,
      ProcessedStripeEventEntity,
    ]),
  ],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
