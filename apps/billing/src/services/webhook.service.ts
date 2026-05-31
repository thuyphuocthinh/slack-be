import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { EJobName, EQueueName, QueueService } from '@slack/queue';
import { ESocketEvent, InvoiceStatus, SubscriptionStatus } from '@slack/constants';
import { UserEntity } from '../../../user/src/entity/user.entity';
import { InvoiceEntity } from '../entity/invoice.entity';
import { PricingPlanEntity } from '../entity/pricing-plan.entity';
import { ProcessedStripeEventEntity } from '../entity/processed-stripe-event.entity';
import { UserSubscriptionEntity } from '../entity/user-subscription.entity';
import { StripeService } from './stripe.service';
import type { HandleWebhookEventDto } from '../dto/billing-request.dto';

// ---------------------------------------------------------------------------
// Minimal internal types for Stripe event data objects (verified by signature)
// ---------------------------------------------------------------------------
interface StripeCheckoutSession {
  id: string;
  subscription: string;
  customer: string;
  metadata: Record<string, string>;
}

interface StripeSubscription {
  id: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
  customer: string;
  items: { data: Array<{ price: { id: string } }> };
}

interface StripeInvoice {
  id: string;
  subscription: string | null;
  customer: string;
  amount_due: number;
  amount_paid: number;
  status: string;
  hosted_invoice_url: string | null;
  period_end: number;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly queueService: QueueService,
    private readonly dataSource: DataSource,
  ) {}

  async handleEvent(dto: HandleWebhookEventDto): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // INSERT idempotency record FIRST with ON CONFLICT DO NOTHING.
      // If the same event is already being processed concurrently, the insert is
      // a no-op (affected = 0) and we skip — eliminating the pre-check race window.
      const result = await manager
        .createQueryBuilder()
        .insert()
        .into(ProcessedStripeEventEntity)
        .values({ eventId: dto.stripeEventId, eventType: dto.type })
        .orIgnore()
        .execute();

      if (result.raw.length === 0) {
        this.logger.warn(`Stripe event ${dto.stripeEventId} (${dto.type}) already processed — skipping`);
        return;
      }

      switch (dto.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(manager, dto.data as unknown as StripeCheckoutSession);
          break;
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(manager, dto.data as unknown as StripeSubscription);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(manager, dto.data as unknown as StripeSubscription);
          break;
        case 'invoice.payment_succeeded':
          await this.handlePaymentSucceeded(manager, dto.data as unknown as StripeInvoice);
          break;
        case 'invoice.payment_failed':
          await this.handlePaymentFailed(manager, dto.data as unknown as StripeInvoice);
          break;
        default:
          this.logger.debug(`Unhandled Stripe event type: ${dto.type} — no action taken`);
          return;
      }
    });

    this.logger.log(`Stripe event ${dto.stripeEventId} (${dto.type}) processed successfully`);
  }

  // ---------------------------------------------------------------------------
  // checkout.session.completed — first successful payment, create subscription
  // ---------------------------------------------------------------------------
  private async handleCheckoutCompleted(
    manager: EntityManager,
    session: StripeCheckoutSession,
  ): Promise<void> {
    const userId = session.metadata?.userId;
    if (!userId) {
      this.logger.error(`checkout.session.completed missing userId in metadata — session: ${session.id}`);
      return;
    }

    // Cast via unknown: Response<Subscription> wraps Subscription but TS
    // doesn't expose current_period_* on the wrapper type in stripe v22
    const stripeSubscription = await this.stripeService.retrieveSubscription(
      session.subscription,
    ) as unknown as StripeSubscription;
    const priceId = stripeSubscription.items.data[0].price.id;

    const plan = await manager.findOneOrFail(PricingPlanEntity, {
      where: { stripePriceId: priceId },
    });

    // Upsert — idempotent if webhook fires more than once
    await manager.upsert(
      UserSubscriptionEntity,
      {
        userId,
        planId: plan.id,
        stripeSubscriptionId: stripeSubscription.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        cancelAtPeriodEnd: false,
      },
      ['userId'],
    );

    this.logger.log(`Subscription created/activated for userId: ${userId}, plan: ${plan.name}`);

    // Emit realtime event to notify the user's browser
    await this.queueService.addJob(EQueueName.SOCKET_QUEUE, EJobName.EMIT_TO_USERS, {
      event: ESocketEvent.BILLING_UPGRADED,
      userIds: [userId],
      data: { planName: plan.name, status: SubscriptionStatus.ACTIVE },
    });
  }

  // ---------------------------------------------------------------------------
  // customer.subscription.updated — renewal, upgrade/downgrade, cancel-at-end
  // ---------------------------------------------------------------------------
  private async handleSubscriptionUpdated(
    manager: EntityManager,
    subscription: StripeSubscription,
  ): Promise<void> {
    const result = await manager.update(
      UserSubscriptionEntity,
      { stripeSubscriptionId: subscription.id },
      {
        status: subscription.status as SubscriptionStatus,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    );

    if (result.affected === 0) {
      this.logger.warn(`subscription.updated — no record found for stripeSubscriptionId: ${subscription.id}`);
    } else {
      this.logger.log(`Subscription ${subscription.id} updated: status=${subscription.status}, cancelAtPeriodEnd=${subscription.cancel_at_period_end}`);
    }
  }

  // ---------------------------------------------------------------------------
  // customer.subscription.deleted — expired or payment failed permanently
  // ---------------------------------------------------------------------------
  private async handleSubscriptionDeleted(
    manager: EntityManager,
    subscription: StripeSubscription,
  ): Promise<void> {
    await manager.update(
      UserSubscriptionEntity,
      { stripeSubscriptionId: subscription.id },
      { status: SubscriptionStatus.CANCELED },
    );
    this.logger.log(`Subscription ${subscription.id} marked as CANCELED`);
  }

  // ---------------------------------------------------------------------------
  // invoice.payment_succeeded — monthly renewal, save invoice + extend period
  // ---------------------------------------------------------------------------
  private async handlePaymentSucceeded(
    manager: EntityManager,
    invoice: StripeInvoice,
  ): Promise<void> {
    const userId = await this.resolveUserIdFromCustomer(manager, invoice.customer);

    if (userId) {
      await manager.upsert(
        InvoiceEntity,
        {
          userId,
          stripeInvoiceId: invoice.id,
          amountDue: invoice.amount_due / 100,    // Stripe amounts are in cents
          amountPaid: invoice.amount_paid / 100,
          status: InvoiceStatus.PAID,
          hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
        },
        ['stripeInvoiceId'],
      );
    }

    if (invoice.subscription) {
      await manager.update(
        UserSubscriptionEntity,
        { stripeSubscriptionId: invoice.subscription },
        {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date(invoice.period_end * 1000),
        },
      );
    }

    this.logger.log(`Payment succeeded for invoice: ${invoice.id}, customer: ${invoice.customer}`);
  }

  // ---------------------------------------------------------------------------
  // invoice.payment_failed — card declined, set past_due, save invoice
  // ---------------------------------------------------------------------------
  private async handlePaymentFailed(
    manager: EntityManager,
    invoice: StripeInvoice,
  ): Promise<void> {
    const userId = await this.resolveUserIdFromCustomer(manager, invoice.customer);

    if (userId) {
      await manager.upsert(
        InvoiceEntity,
        {
          userId,
          stripeInvoiceId: invoice.id,
          amountDue: invoice.amount_due / 100,
          amountPaid: 0,
          status: InvoiceStatus.OPEN,
          hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
        },
        ['stripeInvoiceId'],
      );
    }

    if (invoice.subscription) {
      await manager.update(
        UserSubscriptionEntity,
        { stripeSubscriptionId: invoice.subscription },
        { status: SubscriptionStatus.PAST_DUE },
      );
    }

    this.logger.warn(`Payment failed for invoice: ${invoice.id}, customer: ${invoice.customer}`);
  }

  // ---------------------------------------------------------------------------
  // Helper: resolve userId from Stripe customer ID
  // ---------------------------------------------------------------------------
  private async resolveUserIdFromCustomer(
    manager: EntityManager,
    stripeCustomerId: string,
  ): Promise<string | null> {
    const user = await manager.getRepository(UserEntity).findOne({
      where: { stripeCustomerId },
      select: ['id'],
    });
    if (!user) {
      this.logger.warn(`Cannot resolve userId for Stripe customer: ${stripeCustomerId}`);
      return null;
    }
    return user.id;
  }
}
