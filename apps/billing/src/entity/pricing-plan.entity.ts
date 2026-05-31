import { type PlanFeatures, SubscriptionInterval } from '@slack/constants';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('pricing_plans')
export class PricingPlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100, unique: true })
  name: string;

  @Column({ length: 255, unique: true, name: 'stripe_product_id' })
  stripeProductId: string;

  @Column({ length: 255, unique: true, name: 'stripe_price_id' })
  @Index('IDX_PRICING_PLANS_STRIPE_PRICE_ID')
  stripePriceId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ length: 10 })
  currency: string;

  @Column({ type: 'enum', enum: SubscriptionInterval })
  interval: SubscriptionInterval;

  @Column({ type: 'jsonb' })
  features: PlanFeatures;

  @Column({ default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
