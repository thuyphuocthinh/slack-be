export enum SubscriptionStatus {
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  UNPAID = 'unpaid',
  TRIALING = 'trialing',
}

export enum SubscriptionInterval {
  MONTH = 'month',
  YEAR = 'year',
}

export enum InvoiceStatus {
  DRAFT = 'draft',
  OPEN = 'open',
  PAID = 'paid',
  UNCOLLECTIBLE = 'uncollectible',
  VOID = 'void',
}

export interface PlanFeatures {
  messageHistoryDays: number | null;
  maxStorageGb: number | null;
  videoCall: boolean;
  groupVideoCall: boolean;
  prioritySupport: boolean;
}
