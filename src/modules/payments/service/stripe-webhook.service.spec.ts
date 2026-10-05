import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { StripeWebhookService } from './stripe-webhook.service.js';

/** In-memory stand-in for the Invoice/Payment/ProcessedWebhookEvent delegates this service touches. */
function createFakePrisma() {
  const invoices = new Map<number, any>();
  const payments: any[] = [];
  const processedEvents = new Set<string>();
  let nextPaymentId = 1;

  const fake: any = {
    processedWebhookEvent: {
      findUnique: async ({ where }: any) => (processedEvents.has(where.eventId) ? { eventId: where.eventId } : null),
      create: async ({ data }: any) => {
        if (processedEvents.has(data.eventId)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        }
        processedEvents.add(data.eventId);
        return { eventId: data.eventId };
      },
    },
    invoice: {
      update: async ({ where, data }: any) => {
        const invoice = invoices.get(where.id);
        Object.assign(invoice, data);
        return invoice;
      },
    },
    payment: {
      create: async ({ data }: any) => {
        if (data.stripePaymentIntentId && payments.some((p) => p.stripePaymentIntentId === data.stripePaymentIntentId)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        }
        const payment = { id: nextPaymentId++, ...data };
        payments.push(payment);
        return payment;
      },
      findMany: async ({ where }: any) => payments.filter((p) => p.invoiceId === where.invoiceId),
    },
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const invoiceId = values[0] as number;
      const invoice = invoices.get(invoiceId);
      return invoice ? [{ id: invoice.id, amount: invoice.amount }] : [];
    },
    $transaction: async (fn: any) => fn(fake),
    addInvoice(id: number, overrides: any = {}) {
      invoices.set(id, { id, amount: new Prisma.Decimal('100.00'), status: 'unpaid', paidAt: null, ...overrides });
      return invoices.get(id);
    },
    getInvoice(id: number) {
      return invoices.get(id);
    },
    getPayments() {
      return payments;
    },
    isEventProcessed(eventId: string) {
      return processedEvents.has(eventId);
    },
  };
  return fake;
}

function checkoutSessionCompletedEvent(overrides: {
  id?: string;
  invoiceId?: number | string;
  clientReferenceId?: number | string;
  paymentIntentId?: string;
  amountTotal?: number;
} = {}): any {
  return {
    id: overrides.id ?? 'evt_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        metadata: overrides.invoiceId === undefined ? {} : { invoiceId: String(overrides.invoiceId) },
        client_reference_id: overrides.clientReferenceId === undefined ? null : String(overrides.clientReferenceId),
        payment_intent: overrides.paymentIntentId ?? 'pi_test_1',
        amount_total: overrides.amountTotal ?? 10000,
      },
    },
  };
}

describe('StripeWebhookService', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let events: EventEmitter2;
  let emitSpy: ReturnType<typeof vi.spyOn>;
  let service: StripeWebhookService;

  beforeEach(() => {
    prisma = createFakePrisma();
    events = new EventEmitter2();
    emitSpy = vi.spyOn(events, 'emit');
    service = new StripeWebhookService(prisma as unknown as PrismaService, events, {} as any);
  });

  it('creates a payment, derives invoice status via computeInvoiceStatus, and emits invoice.paid', async () => {
    prisma.addInvoice(1, { amount: new Prisma.Decimal('100.00') });
    const event = checkoutSessionCompletedEvent({ invoiceId: 1, amountTotal: 10000 });

    await service.handleEvent(event);

    const payments = prisma.getPayments();
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ invoiceId: 1, method: 'stripe', stripePaymentIntentId: 'pi_test_1', recordedById: null });
    expect(payments[0].amountPaid.toString()).toBe('100');

    const invoice = prisma.getInvoice(1);
    expect(invoice.status).toBe('paid');
    expect(invoice.paidAt).not.toBeNull();

    expect(prisma.isEventProcessed('evt_1')).toBe(true);
    expect(emitSpy).toHaveBeenCalledWith('invoice.paid', { invoiceId: 1 });
  });

  it('replaying the identical event.id a second time is a no-op — no second payment, no double-counted balance', async () => {
    prisma.addInvoice(1, { amount: new Prisma.Decimal('100.00') });
    const event = checkoutSessionCompletedEvent({ id: 'evt_dup', invoiceId: 1, amountTotal: 10000 });

    await service.handleEvent(event);
    await service.handleEvent(event);

    expect(prisma.getPayments()).toHaveLength(1);
    expect(prisma.getInvoice(1).status).toBe('paid');
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('a different event type is acked (marked processed) with no DB writes beyond that', async () => {
    const event = { id: 'evt_other', type: 'payment_intent.created', data: { object: {} } };

    await service.handleEvent(event as any);

    expect(prisma.getPayments()).toHaveLength(0);
    expect(prisma.isEventProcessed('evt_other')).toBe(true);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('a session whose invoiceId does not exist is logged and acked, not thrown', async () => {
    const event = checkoutSessionCompletedEvent({ invoiceId: 999, amountTotal: 10000 });

    await expect(service.handleEvent(event)).resolves.toBeUndefined();

    expect(prisma.getPayments()).toHaveLength(0);
    expect(prisma.isEventProcessed('evt_1')).toBe(true);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('a session with no usable invoiceId in metadata or client_reference_id is logged and acked', async () => {
    const event = checkoutSessionCompletedEvent({});

    await expect(service.handleEvent(event)).resolves.toBeUndefined();
    expect(prisma.getPayments()).toHaveLength(0);
    expect(prisma.isEventProcessed('evt_1')).toBe(true);
  });

  it('falls back to client_reference_id when metadata.invoiceId is missing', async () => {
    prisma.addInvoice(7, { amount: new Prisma.Decimal('20.00') });
    const event = checkoutSessionCompletedEvent({ clientReferenceId: 7, amountTotal: 2000 });

    await service.handleEvent(event);

    expect(prisma.getPayments()).toHaveLength(1);
    expect(prisma.getPayments()[0].invoiceId).toBe(7);
  });

  it('treats an existing Payment with the same stripePaymentIntentId as already-handled, still acks, does not throw', async () => {
    prisma.addInvoice(1, { amount: new Prisma.Decimal('100.00') });
    const firstEvent = checkoutSessionCompletedEvent({ id: 'evt_a', invoiceId: 1, paymentIntentId: 'pi_shared', amountTotal: 10000 });
    await service.handleEvent(firstEvent);
    emitSpy.mockClear();

    // A different event.id referencing the SAME payment_intent — simulates
    // a race or a duplicate charge notification, not a replay of evt_a
    // (which is already covered by the ProcessedWebhookEvent short-circuit).
    const secondEvent = checkoutSessionCompletedEvent({ id: 'evt_b', invoiceId: 1, paymentIntentId: 'pi_shared', amountTotal: 10000 });
    await expect(service.handleEvent(secondEvent)).resolves.toBeUndefined();

    expect(prisma.getPayments()).toHaveLength(1); // still only one payment row
    expect(prisma.isEventProcessed('evt_b')).toBe(true);
    expect(emitSpy).not.toHaveBeenCalled(); // no second invoice.paid for a no-op
  });

  it('two near-simultaneous deliveries of the same event.id only write one payment (row lock + unique constraint)', async () => {
    // Reuses the exact Module 7 reasoning: the row lock serializes the two
    // transactions, and even if both somehow read the pre-payment state,
    // Payment.stripePaymentIntentId's unique constraint is the backstop
    // that makes the loser's insert fail instead of double-charging the
    // invoice. Simulated here by running both handleEvent() calls
    // concurrently against a shared fake store rather than a real Postgres
    // lock, which this fake doesn't implement — the unique-constraint path
    // is what actually prevents the duplicate in this test.
    prisma.addInvoice(1, { amount: new Prisma.Decimal('100.00') });
    const event = checkoutSessionCompletedEvent({ id: 'evt_race', invoiceId: 1, amountTotal: 10000 });

    await Promise.all([service.handleEvent(event), service.handleEvent(event)]);

    expect(prisma.getPayments()).toHaveLength(1);
    expect(prisma.getInvoice(1).status).toBe('paid');
  });

  it('constructEvent delegates to the Stripe SDK and lets a bad signature throw', () => {
    const stripe = {
      webhooks: {
        constructEvent: vi.fn(() => {
          throw new Error('No signatures found matching the expected signature for payload');
        }),
      },
    };
    const webhookService = new StripeWebhookService(prisma as unknown as PrismaService, events, stripe as any);
    expect(() => webhookService.constructEvent(Buffer.from('{}'), 'bad-sig')).toThrow(/signature/i);
  });
});
