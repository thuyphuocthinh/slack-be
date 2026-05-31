import { InvoiceStatus } from '@slack/constants';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('invoices')
@Index('IDX_INVOICES_USER_ID', ['userId'])
export class InvoiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ length: 255, unique: true, name: 'stripe_invoice_id' })
  stripeInvoiceId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'amount_due' })
  amountDue: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'amount_paid' })
  amountPaid: number;

  @Column({ type: 'enum', enum: InvoiceStatus })
  status: InvoiceStatus;

  @Column({ length: 512, nullable: true, name: 'hosted_invoice_url' })
  hostedInvoiceUrl: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
