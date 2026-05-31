import { PlanFeatures, SubscriptionInterval, SubscriptionStatus } from '@slack/constants';

export interface PlanResponseDto {
  id: string;
  name: string;
  stripePriceId: string;
  price: number;
  currency: string;
  interval: SubscriptionInterval;
  features: PlanFeatures;
}

export interface CheckoutResponseDto {
  checkoutUrl: string;
}

export interface PortalResponseDto {
  portalUrl: string;
}

export interface SubscriptionResponseDto {
  id: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  plan: PlanResponseDto;
}
