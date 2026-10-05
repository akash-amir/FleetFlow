import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { STRIPE_CLIENT } from '../../../common/stripe/stripe-client.provider.js';
import { isUniqueConstraintError } from '../../../common/prisma-errors.js';
import { computeInvoiceStatus } from '../../invoices/service/invoice-status.js';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  /** Throws Stripe.errors.StripeSignatureVerificationError on a bad signature — the controller turns that into a 400. */
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
    return this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }

  async handleEvent(event: Stripe.Event): Promise<void> {
    // Idempotency first, before any type-specific branching: Stripe
    // redelivers the same event on timeout or retry, and this must be a
    // no-op the second time, for every event type, not just the one we act on.
    const already = await this.prisma.processedWebhookEvent.findUnique({ where: { eventId: event.id } });
    if (already) return;

    if (event.type !== 'checkout.session.completed') {
      // Ack and ignore — Stripe's own guidance is to 200 unhandled event
      // types rather than error, since erroring just earns pointless
      // retries for events this handler was never going to act on.
      await this.markProcessed(this.prisma, event.id);
      return;
    }

    await this.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session, event.id);
  }

  /**
   * The `findUnique` check in handleEvent() is only a fast path to skip
   * reprocessing — it runs outside any lock, so two near-simultaneous
   * deliveries of the SAME event.id can both pass it before either commits.
   * What actually makes this idempotent is ProcessedWebhookEvent.eventId
   * being a primary key: every insert attempt goes through this helper so
   * the inevitable loser of that race gets a swallowed unique-constraint
   * error instead of an unhandled one. Takes a plain Prisma-shaped client
   * so it works identically called as `this.prisma` or as a transaction's `tx`.
   */
  private async markProcessed(db: Pick<PrismaService, 'processedWebhookEvent'>, eventId: string): Promise<void> {
    try {
      await db.processedWebhookEvent.create({ data: { eventId } });
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
    }
  }

  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session, eventId: string): Promise<void> {
    const metadataInvoiceId = session.metadata?.invoiceId;
    const refInvoiceId = session.client_reference_id;
    if (metadataInvoiceId && refInvoiceId && metadataInvoiceId !== refInvoiceId) {
      this.logger.warn(
        `checkout.session.completed ${session.id}: metadata.invoiceId (${metadataInvoiceId}) disagrees with client_reference_id (${refInvoiceId}) — using metadata`,
      );
    }
    const invoiceId = Number(metadataInvoiceId ?? refInvoiceId);
    const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;

    if (!Number.isInteger(invoiceId) || !paymentIntentId || session.amount_total == null) {
      // Don't crash and don't retry-loop forever on a malformed/unexpected
      // session — log it for a human to look at and ack the event.
      this.logger.error(
        `checkout.session.completed ${session.id} is missing a usable invoiceId, payment_intent, or amount_total — ignoring`,
      );
      await this.markProcessed(this.prisma, eventId);
      return;
    }
    const amountTotal = session.amount_total;

    const paid = await this.prisma.$transaction(async (tx) => {
      // Same row-lock pattern as InvoicesService.recordPayment: without it,
      // two writes to the same invoice racing each other could both read
      // the same pre-payment balance. The ProcessedWebhookEvent check above
      // already makes a replay of THIS event a no-op before the transaction
      // starts; this lock is insurance against any other overlapping write
      // to the same invoice (a manual payment recorded at the same instant,
      // or — see below — a different Stripe event for the same session).
      const rows = await tx.$queryRaw<Array<{ id: number; amount: Prisma.Decimal }>>`
        SELECT "id", "amount" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE
      `;
      const invoice = rows[0];
      if (!invoice) {
        this.logger.error(`checkout.session.completed ${session.id} references invoice ${invoiceId}, which does not exist`);
        await this.markProcessed(tx, eventId);
        return false;
      }

      try {
        await tx.payment.create({
          data: {
            invoiceId,
            amountPaid: new Prisma.Decimal(amountTotal).div(100),
            method: 'stripe',
            stripePaymentIntentId: paymentIntentId,
            recordedById: null,
          },
        });
      } catch (err) {
        if (!isUniqueConstraintError(err)) throw err;
        // A Payment with this stripePaymentIntentId already exists — this
        // exact charge was already recorded (a previous delivery that
        // raced past the ProcessedWebhookEvent check above, or a second
        // Stripe event referencing the same payment intent). Treat as
        // already-handled: mark this event processed so a retry doesn't
        // keep hitting the DB, but don't touch the invoice again or throw.
        await this.markProcessed(tx, eventId);
        return false;
      }

      const existingPayments = await tx.payment.findMany({ where: { invoiceId }, select: { amountPaid: true } });
      const newStatus = computeInvoiceStatus(new Prisma.Decimal(invoice.amount), existingPayments.map((p) => p.amountPaid));
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: newStatus, paidAt: newStatus === 'paid' ? new Date() : undefined },
      });
      await this.markProcessed(tx, eventId);
      return true;
    });

    if (paid) {
      // Fired after the transaction commits, never from inside it — an
      // event handler that throws must never unwind a committed payment.
      // No slow work (email, etc.) happens inline here or in any listener
      // on this event; that's the whole point of deferring it this way.
      this.eventEmitter.emit('invoice.paid', { invoiceId });
    }
  }
}
