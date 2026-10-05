import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { CheckoutSessionService } from './checkout-session.service.js';

function createFakePrisma() {
  const orders = new Map<number, any>();
  const shipments = new Map<number, any>();
  const invoices = new Map<number, any>();
  const payments: any[] = [];
  let nextOrderId = 1;
  let nextShipmentId = 1;
  let nextInvoiceId = 1;

  const fake: any = {
    invoice: {
      findFirst: async ({ where }: any) => {
        const invoice = [...invoices.values()].find((i) => {
          if (where.id !== undefined && i.id !== where.id) return false;
          const shipment = shipments.get(i.shipmentId);
          const order = orders.get(shipment.orderId);
          return order.customerId === where.shipment.order.customerId;
        });
        if (!invoice) return null;
        return { ...invoice, payments: payments.filter((p) => p.invoiceId === invoice.id) };
      },
    },
    addInvoice(customerId: number, overrides: any = {}) {
      const orderId = nextOrderId++;
      orders.set(orderId, { id: orderId, customerId });
      const shipmentId = nextShipmentId++;
      shipments.set(shipmentId, { id: shipmentId, orderId });
      const invoice = {
        id: nextInvoiceId++,
        shipmentId,
        invoiceNumber: `INV-${String(nextInvoiceId).padStart(6, '0')}`,
        amount: new Prisma.Decimal('100.00'),
        currency: 'usd',
        status: 'unpaid',
        ...overrides,
      };
      invoices.set(invoice.id, invoice);
      return invoice;
    },
    addPayment(invoiceId: number, amountPaid: string) {
      payments.push({ invoiceId, amountPaid: new Prisma.Decimal(amountPaid) });
    },
  };
  return fake;
}

function createFakeStripe() {
  const created: any[] = [];
  return {
    checkout: {
      sessions: {
        create: async (params: any) => {
          created.push(params);
          return { id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' };
        },
      },
    },
    created,
  };
}

describe('CheckoutSessionService', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let stripe: ReturnType<typeof createFakeStripe>;
  let service: CheckoutSessionService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    prisma = createFakePrisma();
    stripe = createFakeStripe();
    service = new CheckoutSessionService(prisma as unknown as PrismaService, stripe as any);
    process.env.FRONTEND_ORIGIN = 'http://localhost:3001';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('creates a checkout session for the customer\'s own unpaid invoice, using the server-computed balance', async () => {
    const invoice = prisma.addInvoice(100, { amount: new Prisma.Decimal('100.00') });
    prisma.addPayment(invoice.id, '40.00');

    const result = await service.createCheckoutSession(100, invoice.id);

    expect(result).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' });
    expect(stripe.created).toHaveLength(1);
    const params = stripe.created[0];
    expect(params.mode).toBe('payment');
    expect(params.line_items[0].price_data.unit_amount).toBe(6000); // (100 - 40) * 100 cents
    expect(params.metadata).toEqual({ invoiceId: String(invoice.id), customerId: '100' });
    expect(params.client_reference_id).toBe(String(invoice.id));
    expect(params.success_url).toBe(`http://localhost:3001/portal/invoices/${invoice.id}?payment=success`);
    expect(params.cancel_url).toBe(`http://localhost:3001/portal/invoices/${invoice.id}?payment=cancelled`);
  });

  it('returns 404 for another customer\'s invoice', async () => {
    const invoice = prisma.addInvoice(101);
    await expect(service.createCheckoutSession(100, invoice.id)).rejects.toThrow(NotFoundException);
    expect(stripe.created).toHaveLength(0);
  });

  it('returns 409 if the invoice is already fully paid', async () => {
    const invoice = prisma.addInvoice(100, { amount: new Prisma.Decimal('50.00'), status: 'paid' });
    prisma.addPayment(invoice.id, '50.00');

    await expect(service.createCheckoutSession(100, invoice.id)).rejects.toThrow(ConflictException);
    expect(stripe.created).toHaveLength(0);
  });

  it('ignores any client-supplied amount — there isn\'t one; the balance always comes from the database', async () => {
    const invoice = prisma.addInvoice(100, { amount: new Prisma.Decimal('75.50') });

    await service.createCheckoutSession(100, invoice.id);

    expect(stripe.created[0].line_items[0].price_data.unit_amount).toBe(7550);
  });
});
