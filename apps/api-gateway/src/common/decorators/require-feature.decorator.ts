import { SetMetadata } from '@nestjs/common';
import type { PlanFeatures } from '@slack/constants';

export const REQUIRE_FEATURE_KEY = 'require_feature';

export const RequireFeature = (feature: keyof PlanFeatures) =>
  SetMetadata(REQUIRE_FEATURE_KEY, feature);
