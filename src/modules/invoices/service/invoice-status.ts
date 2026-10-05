import { Prisma } from '@prisma/client';
import type { InvoiceStatus } from '@prisma/client';

/**
 * Pure — no DB. Always uses Prisma.Decimal, never JS numbers: floating-point
 * addition (0.1 + 0.2 !== 0.3 in IEEE 754) would misclassify a fully-paid
 * invoice as still owing a fraction of a cent. Decimal arithmetic is exact.
 */
export function computeInvoiceStatus(amount: Prisma.Decimal, paymentAmounts: Prisma.Decimal[]): InvoiceStatus {
  const totalPaid = paymentAmounts.reduce((sum, payment) => sum.plus(payment), new Prisma.Decimal(0));
  if (totalPaid.lessThanOrEqualTo(0)) return 'unpaid';
  if (totalPaid.greaterThanOrEqualTo(amount)) return 'paid';
  return 'partially_paid';
}
