import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { BILLING_MESSAGE_PATTERNS, NAME_SERVICE_TCP } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.BILLING_SERVICE)
    private readonly billingClient: ClientProxy,
  ) {}

  getPlans() {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.billingClient.send(BILLING_MESSAGE_PATTERNS.GET_PLANS, {}),
        ),
      'getPlans',
      'BillingService',
    );
  }

  createCheckout(userId: string, planId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.billingClient.send(BILLING_MESSAGE_PATTERNS.CREATE_CHECKOUT, {
            userId,
            planId,
          }),
        ),
      'createCheckout',
      'BillingService',
    );
  }

  createPortal(userId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.billingClient.send(BILLING_MESSAGE_PATTERNS.CREATE_PORTAL, {
            userId,
          }),
        ),
      'createPortal',
      'BillingService',
    );
  }

  getMySubscription(userId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.billingClient.send(
            BILLING_MESSAGE_PATTERNS.GET_MY_SUBSCRIPTION,
            { userId },
          ),
        ),
      'getMySubscription',
      'BillingService',
    );
  }

  getUserFeatureLimits(userId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.billingClient.send(
            BILLING_MESSAGE_PATTERNS.GET_USER_FEATURE_LIMITS,
            { userId },
          ),
        ),
      'getUserFeatureLimits',
      'BillingService',
    );
  }

  handleWebhookEvent(
    stripeEventId: string,
    type: string,
    data: Record<string, unknown>,
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.billingClient.send(
            BILLING_MESSAGE_PATTERNS.HANDLE_WEBHOOK_EVENT,
            {
              stripeEventId,
              type,
              data,
            },
          ),
        ),
      'handleWebhookEvent',
      'BillingService',
    );
  }
}
