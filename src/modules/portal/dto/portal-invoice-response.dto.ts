import { Prisma } from '@prisma/client';
import type { InvoiceStatus } from '@prisma/client';

export interface PortalPaymentSummary {
  amount: Prisma.Decimal;
  method: string;
  paidAt: Date;
}

interface InvoiceEntity {
  id: number;
  invoiceNumber: string;
  amount: Prisma.Decimal;
  currency: string;
  status: InvoiceStatus;
  dueDate: Date;
  paidAt: Date | null;
  payments: Array<{ amountPaid: Prisma.Decimal; method: string; paidAt: Date }>;
}

export class PortalInvoiceResponseDto {
  id!: number;
  invoiceNumber!: string;
  amount!: Prisma.Decimal;
  currency!: string;
  status!: InvoiceStatus;
  dueDate!: Date;
  paidAt!: Date | null;
  amountPaid!: Prisma.Decimal;
  balance!: Prisma.Decimal;
  isOverdue!: boolean;
  payments!: PortalPaymentSummary[];

  static fromEntity(invoice: InvoiceEntity, now: Date = new Date()): PortalInvoiceResponseDto {
    const amountPaid = invoice.payments.reduce((sum, p) => sum.plus(p.amountPaid), new Prisma.Decimal(0));
    const balance = invoice.amount.minus(amountPaid);
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      currency: invoice.currency,
      status: invoice.status,
      dueDate: invoice.dueDate,
      paidAt: invoice.paidAt,
      amountPaid,
      balance,
      isOverdue: invoice.status !== 'paid' && invoice.dueDate < now,
      payments: invoice.payments.map((p) => ({ amount: p.amountPaid, method: p.method, paidAt: p.paidAt })),
    };
  }
}
