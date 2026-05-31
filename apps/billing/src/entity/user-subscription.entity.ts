import { SubscriptionStatus } from '@slack/constants';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { PricingPlanEntity } from './pricing-plan.entity';

@Entity('user_subscriptions')
@Index('IDX_USER_SUBSCRIPTIONS_USER_ID', ['userId'], { unique: true })
export class UserSubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id', unique: true })
  userId: string;

  @Column({ type: 'uuid', name: 'plan_id' })
  planId: string;

  @Column({ length: 255, nullable: true, unique: true, name: 'stripe_subscription_id' })
  stripeSubscriptionId: string;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.ACTIVE,
  })
  status: SubscriptionStatus;

  @Column({ type: 'timestamptz', name: 'current_period_start' })
  currentPeriodStart: Date;

  @Column({ type: 'timestamptz', name: 'current_period_end' })
  currentPeriodEnd: Date;

  @Column({ default: false, name: 'cancel_at_period_end' })
  cancelAtPeriodEnd: boolean;

  @ManyToOne(() => PricingPlanEntity, { eager: false })
  @JoinColumn({ name: 'plan_id' })
  plan: PricingPlanEntity;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  // Optimistic lock — ít tranh chấp (subscription update ít xảy ra đồng thời)
  @VersionColumn({ default: 1, name: 'version' })
  version: number;
}
