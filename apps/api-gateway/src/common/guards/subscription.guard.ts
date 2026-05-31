import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtUser } from '@slack/common';
import { BILLING_ERROR, type PlanFeatures } from '@slack/constants';
import { BillingService } from '../../billing/billing.service';
import { REQUIRE_FEATURE_KEY } from '../decorators/require-feature.decorator';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly billingService: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<keyof PlanFeatures>(
      REQUIRE_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No feature gate on this route — allow
    if (!requiredFeature) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtUser;

    let limits: PlanFeatures;
    try {
      limits = await this.billingService.getUserFeatureLimits(user.sub) as PlanFeatures;
    } catch (err) {
      // Billing service unavailable — degrade gracefully with Free plan limits
      this.logger.warn(`Billing service unavailable for feature check (userId: ${user.sub}): ${err.message}`);
      limits = {
        messageHistoryDays: 90,
        maxStorageGb: 5,
        videoCall: false,
        groupVideoCall: false,
        prioritySupport: false,
      };
    }

    const value = limits[requiredFeature];
    if (value === false || value === 0 || value === null) {
      this.logger.warn(`Feature "${requiredFeature}" blocked for userId: ${user.sub} (plan limit)`);
      throw new ForbiddenException(BILLING_ERROR.FEATURE_RESTRICTED);
    }

    return true;
  }
}
