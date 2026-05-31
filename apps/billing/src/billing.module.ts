import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@slack/database';
import { EQueueName, QueueModule } from '@slack/queue';
import { BillingController } from './billing.controller';
import { BillingService } from './services/billing.service';
import { StripeService } from './services/stripe.service';
import { WebhookService } from './services/webhook.service';
import { InvoiceEntity } from './entity/invoice.entity';
import { PricingPlanEntity } from './entity/pricing-plan.entity';
import { ProcessedStripeEventEntity } from './entity/processed-stripe-event.entity';
import { UserSubscriptionEntity } from './entity/user-subscription.entity';

@Module({
  imports: [
    DatabaseModule,
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.SOCKET_QUEUE]),
    TypeOrmModule.forFeature([
      PricingPlanEntity,
      UserSubscriptionEntity,
      InvoiceEntity,
      ProcessedStripeEventEntity,
    ]),
  ],
  controllers: [BillingController],
  providers: [BillingService, StripeService, WebhookService],
})
export class BillingModule {}
