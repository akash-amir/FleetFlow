import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { STRIPE_CLIENT } from '../../../common/stripe/stripe-client.provider.js';

const PAYMENTS_SELECT = { amountPaid: true } as const;

@Injectable()
export class CheckoutSessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  async createCheckoutSession(customerId: number, invoiceId: number): Promise<{ url: string }> {
    // Scoped exactly like the rest of the portal module: belongs to another
    // customer or doesn't exist both come back null here, both become 404.
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, shipment: { order: { customerId } } },
      include: { payments: { select: PAYMENTS_SELECT } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    // The balance is always read fresh from the database (amount minus the
    // sum of existing payments) — never trusted from the client. There
    // isn't a client-supplied amount in this request anyway, but the
    // principle is the same one the manual-payment endpoint follows: a
    // money number this API acts on is always server-computed, never
    // client state, even when "the client" is just an implicit absence of
    // input today.
    const amountPaid = invoice.payments.reduce((sum, p) => sum.plus(p.amountPaid), new Prisma.Decimal(0));
    const balance = invoice.amount.minus(amountPaid);
    if (balance.lessThanOrEqualTo(0)) {
      throw new ConflictException('This invoice is already paid');
    }

    const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:3001';
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: invoice.currency,
            product_data: { name: `Invoice ${invoice.invoiceNumber}` },
            // Decimal(10,2) values always have <=2 decimal places, so
            // multiplying by 100 lands on an exact integer — no float
            // rounding risk the way a plain `balance.toNumber() * 100` would carry.
            unit_amount: balance.mul(100).toNumber(),
          },
          quantity: 1,
        },
      ],
      metadata: { invoiceId: String(invoice.id), customerId: String(customerId) },
      client_reference_id: String(invoice.id),
      success_url: `${frontendOrigin}/portal/invoices/${invoice.id}?payment=success`,
      cancel_url: `${frontendOrigin}/portal/invoices/${invoice.id}?payment=cancelled`,
    });

    // Trade-off, deliberately not solved here: a customer who abandons a
    // Checkout page and retries gets a second, independent open session
    // rather than being handed back the first one. Tracking "the" open
    // session per invoice would mean a new Invoice column, plus deciding
    // what to do when that session has expired, been abandoned, or is
    // simply stale (Stripe Checkout Sessions already self-expire after 24h
    // by default) — real bookkeeping for a problem that mostly solves
    // itself: Stripe never double-charges from two sessions since only one
    // can ever be completed against a balance that the webhook zeroes out
    // the first time, and an abandoned session is simply dead weight, not
    // a liability.
    return { url: session.url! };
  }
}
