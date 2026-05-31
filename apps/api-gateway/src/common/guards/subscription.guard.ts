import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtUser } from '@slack/common';
import { IS_PUBLIC_KEY } from '@slack/common';
import { BILLING_ERROR, type PlanFeatures } from '@slack/constants';
import { BillingService } from '../../billing/billing.service';
import { REQUIRE_FEATURE_KEY } from '../decorators/require-feature.decorator';

interface CacheEntry {
  limits: PlanFeatures;
  expiresAt: number;
}

const FREE_LIMITS: PlanFeatures = {
  messageHistoryDays: 90,
  maxStorageGb: 5,
  videoCall: false,
  groupVideoCall: false,
  prioritySupport: false,
};

@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionGuard.name);
  // Per-user in-memory cache — avoids a billing TCP call on every gated request
  private readonly cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 60_000; // 1 minute

  constructor(
    private readonly reflector: Reflector,
    private readonly billingService: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Short-circuit: @Public() routes bypass all guards
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredFeature = this.reflector.getAllAndOverride<keyof PlanFeatures>(
      REQUIRE_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    // No feature gate on this route — allow
    if (!requiredFeature) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtUser | undefined;
    // Guard only runs after JwtAuthGuard so user should always be set here,
    // but we null-check defensively in case of misconfiguration
    if (!user?.sub) return false;

    const limits = await this.getFeatureLimits(user.sub);
    const value = limits[requiredFeature];

    if (value === false || value === 0 || value === null) {
      this.logger.warn(`Feature "${requiredFeature}" blocked for userId: ${user.sub} (plan limit)`);
      throw new ForbiddenException(BILLING_ERROR.FEATURE_RESTRICTED);
    }

    return true;
  }

  private async getFeatureLimits(userId: string): Promise<PlanFeatures> {
    const now = Date.now();
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > now) return cached.limits;

    try {
      const raw = await this.billingService.getUserFeatureLimits(userId);
      // Validate shape before trusting the value from the microservice
      const limits = this.isPlanFeatures(raw) ? raw : FREE_LIMITS;
      this.cache.set(userId, { limits, expiresAt: now + this.CACHE_TTL_MS });
      return limits;
    } catch (err) {
      this.logger.warn(`Billing service unavailable for feature check (userId: ${userId}): ${err.message}`);
      return FREE_LIMITS;
    }
  }

  private isPlanFeatures(value: unknown): value is PlanFeatures {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
      'videoCall' in v &&
      'groupVideoCall' in v &&
      'prioritySupport' in v &&
      'messageHistoryDays' in v &&
      'maxStorageGb' in v
    );
  }
}
