import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// Idempotency table — mỗi Stripe event chỉ được xử lý đúng 1 lần
@Entity('processed_stripe_events')
export class ProcessedStripeEventEntity {
  // PrimaryColumn = Stripe event ID (đã unique theo thiết kế của Stripe)
  @PrimaryColumn({ length: 255, name: 'event_id' })
  eventId: string;

  @Column({ length: 100, name: 'event_type' })
  eventType: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'processed_at' })
  processedAt: Date;
}
