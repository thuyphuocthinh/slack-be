import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@slack/common';
import { BILLING_ERROR } from '@slack/constants';
import type { Request } from 'express';
import Stripe from 'stripe';
import { BillingService } from './billing.service';

@Controller('webhooks')
@ApiExcludeController()
export class StripeWebhookController {
  private readonly stripe: InstanceType<typeof Stripe>;
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private readonly billingService: BillingService) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
      apiVersion: '2026-05-27.dahlia',
    });
  }

  @Post('stripe')
  @Public()
  @HttpCode(200)
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

    if (!req.rawBody) {
      throw new BadRequestException('Missing raw body — ensure rawBody: true is set in NestFactory.create');
    }

    if (!signature) {
      throw new BadRequestException(BILLING_ERROR.INVALID_WEBHOOK_SIGNATURE.message);
    }

    let event: ReturnType<typeof this.stripe.webhooks.constructEvent>;
    try {
      event = this.stripe.webhooks.constructEvent(req.rawBody, signature, webhookSecret);
    } catch (err) {
      this.logger.warn(`Stripe webhook signature verification failed: ${err.message}`);
      throw new BadRequestException(BILLING_ERROR.INVALID_WEBHOOK_SIGNATURE.message);
    }

    this.logger.log(`Received Stripe webhook: ${event.type} (${event.id})`);

    await this.billingService.handleWebhookEvent(
      event.id,
      event.type,
      event.data.object as unknown as Record<string, unknown>,
    );

    // Stripe expects 2xx — must always return even if billing service processes async
    return { received: true };
  }
}
