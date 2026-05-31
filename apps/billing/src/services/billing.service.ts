import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import {
  BILLING_ERROR,
  PlanFeatures,
  SubscriptionStatus,
} from '@slack/constants';
import { StripeService } from './stripe.service';
import { PricingPlanEntity } from '../entity/pricing-plan.entity';
import { UserSubscriptionEntity } from '../entity/user-subscription.entity';
import { NAME_SERVICE_TCP, USER_MESSAGE_PATTERNS } from '@slack/constants';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import type {
  CheckoutResponseDto,
  PlanResponseDto,
  PortalResponseDto,
  SubscriptionResponseDto,
} from '../dto/billing-response.dto';
import type {
  CreateCheckoutRequestDto,
  CreatePortalRequestDto,
  GetMySubscriptionRequestDto,
  GetUserFeatureLimitsRequestDto,
} from '../dto/billing-request.dto';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(PricingPlanEntity)
    private readonly planRepository: Repository<PricingPlanEntity>,
    @InjectRepository(UserSubscriptionEntity)
    private readonly subscriptionRepository: Repository<UserSubscriptionEntity>,
    private readonly stripeService: StripeService,
    private readonly dataSource: DataSource,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
  ) { }

  async getPlans(): Promise<PlanResponseDto[]> {
    const plans = await this.planRepository.find({
      where: { isActive: true },
      order: { price: 'ASC' },
    });
    this.logger.log(`Fetched ${plans.length} active plans`);
    // Arrow function preserves `this` context
    return plans.map((p) => this.mapPlanToDto(p));
  }

  async createCheckout(dto: CreateCheckoutRequestDto): Promise<CheckoutResponseDto> {
    const { userId, planId } = dto;
    this.logger.log(`Creating checkout for userId: ${userId}, planId: ${planId}`);

    // Phase 1 — validate plan (no lock needed)
    const plan = await this.planRepository.findOne({ where: { id: planId, isActive: true } });
    if (!plan) {
      this.logger.warn(`Plan not found or inactive: ${planId}`);
      throw new RpcException({ ...BILLING_ERROR.PLAN_NOT_FOUND, statusCode: HttpStatus.NOT_FOUND });
    }

    // Phase 2 — get or create Stripe customer via TCP
    let stripeCustomerId: string;

    const user = await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_ID, { id: userId })
    ).catch(() => null);

    if (!user) {
      this.logger.warn(`User not found for checkout: ${userId}`);
      throw new RpcException({
        ...BILLING_ERROR.STRIPE_CUSTOMER_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    }

    if (!user.stripeCustomerId) {
      this.logger.log(`No Stripe customer for userId: ${userId} — creating new customer`);
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
      const customer = await this.stripeService.createCustomer(user.email, fullName || user.email);

      // Update stripe customer id via TCP
      await firstValueFrom(
        this.userClient.send(USER_MESSAGE_PATTERNS.UPDATE_USER_STRIPE_ID, {
          id: userId,
          stripeCustomerId: customer.id
        })
      );
      stripeCustomerId = customer.id;
    } else {
      stripeCustomerId = user.stripeCustomerId;
    }

    // Phase 3 — create Stripe checkout session OUTSIDE the transaction
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const session = await this.stripeService.createCheckoutSession(
      stripeCustomerId!,
      plan.stripePriceId,
      userId,
      `${frontendUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      `${frontendUrl}/checkout/cancel`,
    );

    if (!session.url) {
      this.logger.error(`Stripe checkout session created but URL is null for userId: ${userId}`);
      throw new RpcException({ ...BILLING_ERROR.CHECKOUT_FAILED, statusCode: HttpStatus.INTERNAL_SERVER_ERROR });
    }

    this.logger.log(`Checkout session ready for userId: ${userId}`);
    return { checkoutUrl: session.url };
  }

  async createPortal(dto: CreatePortalRequestDto): Promise<PortalResponseDto> {
    const { userId } = dto;
    this.logger.log(`Creating customer portal for userId: ${userId}`);

    const user = await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_ID, { id: userId })
    ).catch(() => null);

    if (!user?.stripeCustomerId) {
      this.logger.warn(`No Stripe customer found for userId: ${userId}`);
      throw new RpcException({
        ...BILLING_ERROR.STRIPE_CUSTOMER_NOT_FOUND,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const session = await this.stripeService.createPortalSession(
      user.stripeCustomerId,
      `${frontendUrl}/settings/billing`,
    );

    this.logger.log(`Portal session created for userId: ${userId}`);
    return { portalUrl: session.url };
  }

  async getMySubscription(dto: GetMySubscriptionRequestDto): Promise<SubscriptionResponseDto> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { userId: dto.userId },
      relations: ['plan'],
    });
    if (!subscription) {
      this.logger.warn(`Subscription not found for userId: ${dto.userId}`);
      throw new RpcException({
        ...BILLING_ERROR.SUBSCRIPTION_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    }
    return this.mapSubscriptionToDto(subscription);
  }

  async getUserFeatureLimits(dto: GetUserFeatureLimitsRequestDto): Promise<PlanFeatures> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { userId: dto.userId, status: SubscriptionStatus.ACTIVE },
      relations: ['plan'],
    });

    if (!subscription) {
      this.logger.debug(`No active subscription for userId: ${dto.userId} — returning Free plan limits`);
      return {
        messageHistoryDays: 90,
        maxStorageGb: 5,
        videoCall: false,
        groupVideoCall: false,
        prioritySupport: false,
      };
    }

    this.logger.debug(`Feature limits for userId: ${dto.userId} — plan: ${subscription.plan.name}`);
    return subscription.plan.features;
  }

  private mapPlanToDto(plan: PricingPlanEntity): PlanResponseDto {
    return {
      id: plan.id,
      name: plan.name,
      stripePriceId: plan.stripePriceId,
      price: plan.price,
      currency: plan.currency,
      interval: plan.interval,
      features: plan.features,
    };
  }

  private mapSubscriptionToDto(sub: UserSubscriptionEntity): SubscriptionResponseDto {
    return {
      id: sub.id,
      status: sub.status,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      plan: {
        id: sub.plan.id,
        name: sub.plan.name,
        stripePriceId: sub.plan.stripePriceId,
        price: sub.plan.price,
        currency: sub.plan.currency,
        interval: sub.plan.interval,
        features: sub.plan.features,
      },
    };
  }
}
