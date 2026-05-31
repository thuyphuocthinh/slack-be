export const BILLING_MESSAGE_PATTERNS = {
  GET_PLANS: 'billing.get_plans',
  CREATE_CHECKOUT: 'billing.create_checkout',
  CREATE_PORTAL: 'billing.create_portal',
  GET_MY_SUBSCRIPTION: 'billing.get_my_subscription',
  HANDLE_WEBHOOK_EVENT: 'billing.handle_webhook_event',
  GET_USER_FEATURE_LIMITS: 'billing.get_user_feature_limits',
} as const;
