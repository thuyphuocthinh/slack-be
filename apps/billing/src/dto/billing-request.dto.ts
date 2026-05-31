export class CreateCheckoutRequestDto {
  userId: string;
  planId: string;
}

export class CreatePortalRequestDto {
  userId: string;
}

export class GetMySubscriptionRequestDto {
  userId: string;
}

export class GetUserFeatureLimitsRequestDto {
  userId: string;
}
