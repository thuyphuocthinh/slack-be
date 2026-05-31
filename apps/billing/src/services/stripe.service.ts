import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  // InstanceType<typeof Stripe>: instance của Stripe constructor (stripe v22 pattern)
  private readonly stripe: InstanceType<typeof Stripe>;

  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
      apiVersion: '2026-05-27.dahlia',
    });
  }

  async createCustomer(email: string, name: string) {
    const customer = await this.stripe.customers.create({ email, name });
    this.logger.log(`Created Stripe customer: ${customer.id} for email: ${email}`);
    return customer;
  }

  async createCheckoutSession(
    customerId: string,
    priceId: string,
    userId: string,
    successUrl: string,
    cancelUrl: string,
  ) {
    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId },
    });
    this.logger.log(`Created checkout session: ${session.id} for customer: ${customerId}`);
    return session;
  }

  async createPortalSession(customerId: string, returnUrl: string) {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    this.logger.log(`Created portal session for customer: ${customerId}`);
    return session;
  }

  // Dùng ở Stage 4 — retrieve để lấy stripePriceId từ webhook
  retrieveSubscription(subscriptionId: string) {
    return this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price'],
    });
  }

  // Dùng ở Stage 4 — verify Stripe webhook signature
  constructWebhookEvent(payload: Buffer, signature: string, secret: string) {
    return this.stripe.webhooks.constructEvent(payload, signature, secret);
  }
}
