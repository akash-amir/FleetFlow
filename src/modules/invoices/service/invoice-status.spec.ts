import { Prisma } from '@prisma/client';
import { computeInvoiceStatus } from './invoice-status.js';

const d = (value: string) => new Prisma.Decimal(value);

describe('computeInvoiceStatus', () => {
  it('is unpaid with no payments', () => {
    expect(computeInvoiceStatus(d('100.00'), [])).toBe('unpaid');
  });

  it('is partially_paid when payments are less than the amount', () => {
    expect(computeInvoiceStatus(d('100.00'), [d('40.00')])).toBe('partially_paid');
  });

  it('is paid when payments exactly equal the amount', () => {
    expect(computeInvoiceStatus(d('100.00'), [d('60.00'), d('40.00')])).toBe('paid');
  });

  it('is paid when payments exceed the amount (overpayment)', () => {
    expect(computeInvoiceStatus(d('100.00'), [d('120.00')])).toBe('paid');
  });

  it('handles the classic 0.1 + 0.2 float trap correctly via Decimal', () => {
    // In plain JS numbers, 0.1 + 0.2 === 0.30000000000000004 !== 0.3.
    expect(computeInvoiceStatus(d('0.3'), [d('0.1'), d('0.2')])).toBe('paid');
  });

  it('is not paid by a cent short', () => {
    expect(computeInvoiceStatus(d('10.00'), [d('9.99')])).toBe('partially_paid');
  });
});
