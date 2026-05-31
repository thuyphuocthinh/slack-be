import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { BILLING_MESSAGE_PATTERNS } from '@slack/constants';
import { BillingService } from './services/billing.service';
import {
  CreateCheckoutRequestDto,
  CreatePortalRequestDto,
  GetMySubscriptionRequestDto,
  GetUserFeatureLimitsRequestDto,
} from './dto/billing-request.dto';

@Controller()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @MessagePattern(BILLING_MESSAGE_PATTERNS.GET_PLANS)
  getPlans() {
    return this.billingService.getPlans();
  }

  @MessagePattern(BILLING_MESSAGE_PATTERNS.CREATE_CHECKOUT)
  createCheckout(@Payload() dto: CreateCheckoutRequestDto) {
    return this.billingService.createCheckout(dto);
  }

  @MessagePattern(BILLING_MESSAGE_PATTERNS.CREATE_PORTAL)
  createPortal(@Payload() dto: CreatePortalRequestDto) {
    return this.billingService.createPortal(dto);
  }

  @MessagePattern(BILLING_MESSAGE_PATTERNS.GET_MY_SUBSCRIPTION)
  getMySubscription(@Payload() dto: GetMySubscriptionRequestDto) {
    return this.billingService.getMySubscription(dto);
  }

  @MessagePattern(BILLING_MESSAGE_PATTERNS.GET_USER_FEATURE_LIMITS)
  getUserFeatureLimits(@Payload() dto: GetUserFeatureLimitsRequestDto) {
    return this.billingService.getUserFeatureLimits(dto);
  }
}
