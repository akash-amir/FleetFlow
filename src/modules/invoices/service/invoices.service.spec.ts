import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { InvoicesService } from './invoices.service.js';
import { InvoiceEventsListener } from './invoice-events.listener.js';

/** In-memory stand-in for PrismaService's shipment/invoice/payment delegates, including $queryRaw's FOR UPDATE lock query. */
function createFakePrisma() {
  const shipments = new Map<number, any>();
  const orders = new Map<number, any>();
  const invoices = new Map<number, any>();
  const payments: any[] = [];
  let nextOrderId = 1;
  let nextShipmentId = 1;
  let nextInvoiceId = 1;
  let nextPaymentId = 1;
  let seq = 1;

  const fake: any = {
    shipment: {
      findUnique: async ({ where, include }: any) => {
        const shipment = shipments.get(where.id);
        if (!shipment) return null;
        return include?.order ? { ...shipment, order: orders.get(shipment.orderId) ?? null } : shipment;
      },
    },
    invoice: {
      create: async ({ data }: any) => {
        const clash = [...invoices.values()].some((i) => i.shipmentId === data.shipmentId);
        if (clash) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        }
        const invoice = {
          id: nextInvoiceId++,
          invoiceNumber: `INV-${String(seq++).padStart(6, '0')}`,
          status: 'unpaid',
          paidAt: null,
          sentAt: null,
          createdAt: new Date(),
          ...data,
        };
        invoices.set(invoice.id, invoice);
        return invoice;
      },
      findUnique: async ({ where, include }: any) => {
        const invoice = where.id != null ? invoices.get(where.id) : [...invoices.values()].find((i) => i.shipmentId === where.shipmentId);
        if (!invoice) return null;
        if (!include) return invoice;
        const result: any = { ...invoice };
        if (include.payments) result.payments = payments.filter((p) => p.invoiceId === invoice.id);
        if (include.shipment) {
          const shipment = shipments.get(invoice.shipmentId);
          result.shipment = shipment ? { ...shipment, order: orders.get(shipment.orderId) ?? null } : null;
        }
        return result;
      },
      findMany: async () => [...invoices.values()],
      count: async () => invoices.size,
      update: async ({ where, data }: any) => {
        const invoice = invoices.get(where.id);
        // Real Prisma omits `undefined` fields from the UPDATE entirely
        // (unlike Object.assign, which would overwrite with `undefined`).
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) invoice[key] = value;
        }
        return invoice;
      },
    },
    payment: {
      create: async ({ data }: any) => {
        const payment = { id: nextPaymentId++, paidAt: new Date(), ...data };
        payments.push(payment);
        return payment;
      },
      findMany: async ({ where }: any) => payments.filter((p) => p.invoiceId === where.invoiceId),
    },
    // Fakes `tx.$queryRaw<...>SELECT "id","amount" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`
    // — a tagged template call, so this fake is itself a valid tag function.
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const invoiceId = values[0] as number;
      const invoice = invoices.get(invoiceId);
      return invoice ? [{ id: invoice.id, amount: invoice.amount }] : [];
    },
    $transaction: async (fn: any) => fn(fake),
    addShipment(overrides: { shipment?: Record<string, unknown>; order?: Record<string, unknown> } = {}): number {
      const orderId = nextOrderId++;
      orders.set(orderId, { id: orderId, deliveryFee: new Prisma.Decimal('49.99'), customerId: 1, ...overrides.order });
      const shipmentId = nextShipmentId++;
      shipments.set(shipmentId, { id: shipmentId, orderId, status: 'delivered', ...overrides.shipment });
      return shipmentId;
    },
  };
  return fake;
}

describe('InvoicesService', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let service: InvoicesService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    prisma = createFakePrisma();
    service = new InvoicesService(prisma as unknown as PrismaService);
    process.env.INVOICE_DUE_DAYS = '14';
    process.env.DEFAULT_CURRENCY = 'usd';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('creates an invoice with the deliveryFee snapshot, resolved currency, and a ~14-day dueDate', async () => {
    const shipmentId = prisma.addShipment({ order: { deliveryFee: new Prisma.Decimal('75.00') } });

    const invoice = await service.createForDeliveredShipment(shipmentId);

    expect(invoice).not.toBeNull();
    expect(invoice!.amount.toString()).toBe('75');
    expect(invoice!.currency).toBe('usd');
    expect(invoice!.status).toBe('unpaid');
    const daysUntilDue = (invoice!.dueDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysUntilDue).toBeGreaterThan(13.9);
    expect(daysUntilDue).toBeLessThan(14.1);
  });

  it('is idempotent: a duplicate event creates only one invoice', async () => {
    const shipmentId = prisma.addShipment();

    const first = await service.createForDeliveredShipment(shipmentId);
    const second = await service.createForDeliveredShipment(shipmentId);

    expect(first).not.toBeNull();
    expect(second).toBeNull(); // silent no-op, by design — not an error
    expect(await prisma.invoice.count()).toBe(1);
  });

  describe('generateForShipment (fallback endpoint)', () => {
    it('creates an invoice for a delivered shipment with none', async () => {
      const shipmentId = prisma.addShipment();
      const invoice = await service.generateForShipment(shipmentId);
      expect(invoice.shipmentId).toBe(shipmentId);
    });

    it('rejects with 409 if the shipment is not delivered', async () => {
      const shipmentId = prisma.addShipment({ shipment: { status: 'in_transit' } });
      await expect(service.generateForShipment(shipmentId)).rejects.toThrow(ConflictException);
    });

    it('rejects with 409 if an invoice already exists', async () => {
      const shipmentId = prisma.addShipment();
      await service.generateForShipment(shipmentId);
      await expect(service.generateForShipment(shipmentId)).rejects.toThrow(ConflictException);
    });
  });

  describe('recordPayment', () => {
    it('moves unpaid -> partially_paid -> paid across two payments, setting paidAt only once paid', async () => {
      const shipmentId = prisma.addShipment({ order: { deliveryFee: new Prisma.Decimal('100.00') } });
      const invoice = await service.generateForShipment(shipmentId);
      expect(invoice.status).toBe('unpaid');
      expect(invoice.paidAt).toBeNull();

      const afterPartial = await service.recordPayment(invoice.id, { amountPaid: 40, method: 'cash' }, 1);
      expect(afterPartial.status).toBe('partially_paid');
      expect(afterPartial.paidAt).toBeNull();

      const afterFull = await service.recordPayment(invoice.id, { amountPaid: 60, method: 'bank_transfer', reference: 'REF-1' }, 1);
      expect(afterFull.status).toBe('paid');
      expect(afterFull.paidAt).not.toBeNull();
    });

    it('rejects an overpayment with 400', async () => {
      const shipmentId = prisma.addShipment({ order: { deliveryFee: new Prisma.Decimal('50.00') } });
      const invoice = await service.generateForShipment(shipmentId);
      await expect(service.recordPayment(invoice.id, { amountPaid: 60, method: 'cash' }, 1)).rejects.toThrow(BadRequestException);
    });
  });
});

describe('InvoiceEventsListener', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let service: InvoicesService;
  let listener: InvoiceEventsListener;

  beforeEach(() => {
    prisma = createFakePrisma();
    service = new InvoicesService(prisma as unknown as PrismaService);
    listener = new InvoiceEventsListener(service);
  });

  it('creates an invoice when toStatus is delivered', async () => {
    const shipmentId = prisma.addShipment();

    await listener.handleShipmentStatusChanged({ shipmentId, fromStatus: 'in_transit', toStatus: 'delivered', driverId: 1, changedById: 1 });

    const invoice = await prisma.invoice.findUnique({ where: { shipmentId } });
    expect(invoice).not.toBeNull();
  });

  it('ignores every transition that is not "delivered"', async () => {
    const shipmentId = prisma.addShipment({ shipment: { status: 'in_transit' } });

    await listener.handleShipmentStatusChanged({ shipmentId, fromStatus: 'picked_up', toStatus: 'in_transit', driverId: 1, changedById: 1 });

    expect(await prisma.invoice.findUnique({ where: { shipmentId } })).toBeNull();
  });

  it('never throws, even when invoice creation fails', async () => {
    prisma.shipment.findUnique = async () => {
      throw new Error('simulated DB outage');
    };

    await expect(
      listener.handleShipmentStatusChanged({ shipmentId: 999, fromStatus: 'in_transit', toStatus: 'delivered', driverId: 1, changedById: 1 }),
    ).resolves.toBeUndefined();
  });
});
