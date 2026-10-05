import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Invoice } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { PaginatedResult } from '../../../common/pagination.js';
import { isUniqueConstraintError } from '../../../common/prisma-errors.js';
import { computeInvoiceStatus } from './invoice-status.js';
import { RecordPaymentDto } from '../dto/record-payment.dto.js';
import { ListInvoicesQueryDto } from '../dto/list-invoices.query.dto.js';

const DEFAULT_INVOICE_DUE_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function resolveCurrency(): string {
  return process.env.DEFAULT_CURRENCY || 'usd';
}

function resolveDueDate(): Date {
  const days = Number(process.env.INVOICE_DUE_DAYS);
  const validDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_INVOICE_DUE_DAYS;
  return new Date(Date.now() + validDays * MS_PER_DAY);
}

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent primitive shared by both callers: the auto-generation event
   * listener (silent no-op on conflict) and generateForShipment() (turns a
   * conflict into a 409). The DB's unique constraint on Invoice.shipmentId
   * is the actual source of truth for idempotency — this never does a
   * check-then-insert race.
   */
  private async createInvoiceRow(shipmentId: number): Promise<Invoice | null> {
    const shipment = await this.prisma.shipment.findUnique({ where: { id: shipmentId }, include: { order: true } });
    if (!shipment) return null;

    // Defensive only: shipment creation already requires a non-null
    // deliveryFee (see ShipmentsService.create), so this should be
    // unreachable. If it ever happens anyway, skip silently rather than
    // insert an invoice with no real amount — same "safe to ignore" shape
    // as the unique-constraint race below.
    if (shipment.order.deliveryFee === null) return null;

    try {
      return await this.prisma.invoice.create({
        data: {
          shipmentId,
          amount: shipment.order.deliveryFee, // snapshot — later changes to the order never retroactively change an issued invoice
          currency: resolveCurrency(),
          dueDate: resolveDueDate(),
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) return null; // already exists — safe to ignore, by design
      throw err;
    }
  }

  /** Called by the shipment.status.changed listener. Never throws — see the listener for why. */
  async createForDeliveredShipment(shipmentId: number): Promise<Invoice | null> {
    return this.createInvoiceRow(shipmentId);
  }

  /** POST /shipments/:id/invoice — the human-triggered fallback for a shipment the auto-listener missed. */
  async generateForShipment(shipmentId: number): Promise<Invoice> {
    const shipment = await this.prisma.shipment.findUnique({ where: { id: shipmentId }, include: { order: true } });
    if (!shipment) throw new NotFoundException('Shipment not found');
    if (shipment.status !== 'delivered') {
      throw new ConflictException(`Shipment must be delivered to generate an invoice (current status: ${shipment.status})`);
    }
    const existing = await this.prisma.invoice.findUnique({ where: { shipmentId } });
    if (existing) throw new ConflictException('An invoice already exists for this shipment');
    if (shipment.order.deliveryFee === null) {
      // Should be unreachable — shipment creation already requires a fee.
      throw new ConflictException('Order has no delivery fee set — cannot generate an invoice');
    }

    const created = await this.createInvoiceRow(shipmentId);
    if (!created) {
      // Lost a race against a concurrent create (the event listener, or
      // another call to this same endpoint) between the checks above and
      // the insert.
      throw new ConflictException('An invoice already exists for this shipment');
    }
    return created;
  }

  async findAll(query: ListInvoicesQueryDto): Promise<PaginatedResult<Invoice>> {
    const conditions: Prisma.InvoiceWhereInput[] = [];
    if (query.status) conditions.push({ status: query.status });
    if (query.customerId) conditions.push({ shipment: { order: { customerId: query.customerId } } });
    if (query.overdue) conditions.push({ dueDate: { lt: new Date() }, status: { not: 'paid' } });
    const where: Prisma.InvoiceWhereInput = conditions.length ? { AND: conditions } : {};

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { id: 'asc' },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, meta: { page: query.page, limit: query.limit, total } };
  }

  async findOne(id: number) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        payments: { orderBy: { paidAt: 'asc' } },
        shipment: {
          select: {
            id: true,
            status: true,
            order: { select: { id: true, customer: { select: { id: true, companyName: true, email: true } } } },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const amountPaid = invoice.payments.reduce((sum, payment) => sum.plus(payment.amountPaid), new Prisma.Decimal(0));
    const balance = invoice.amount.minus(amountPaid);

    return { ...invoice, amountPaid, balance };
  }

  async recordPayment(invoiceId: number, dto: RecordPaymentDto, recordedById: number): Promise<Invoice> {
    return this.prisma.$transaction(async (tx) => {
      // Row lock via SELECT ... FOR UPDATE: without it, two concurrent
      // payment requests could both read the same "existing payments" sum
      // before either commits, both compute the same remaining balance, and
      // both pass the "amountPaid <= balance" check below — together
      // overpaying the invoice. Locking serializes them: the second
      // request blocks until the first transaction commits, then re-reads
      // a balance that already reflects the first payment.
      const rows = await tx.$queryRaw<Array<{ id: number; amount: Prisma.Decimal }>>`
        SELECT "id", "amount" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE
      `;
      const invoice = rows[0];
      if (!invoice) throw new NotFoundException('Invoice not found');
      const amount = new Prisma.Decimal(invoice.amount);

      const existingPayments = await tx.payment.findMany({ where: { invoiceId }, select: { amountPaid: true } });
      const totalPaidSoFar = existingPayments.reduce((sum, p) => sum.plus(p.amountPaid), new Prisma.Decimal(0));
      const balance = amount.minus(totalPaidSoFar);

      const amountPaid = new Prisma.Decimal(dto.amountPaid);
      if (amountPaid.greaterThan(balance)) {
        throw new BadRequestException(`Payment of ${amountPaid} exceeds the remaining balance of ${balance}`);
      }

      await tx.payment.create({
        data: { invoiceId, amountPaid, method: dto.method, reference: dto.reference, recordedById },
      });

      const newStatus = computeInvoiceStatus(amount, [...existingPayments.map((p) => p.amountPaid), amountPaid]);
      return tx.invoice.update({
        where: { id: invoiceId },
        data: { status: newStatus, paidAt: newStatus === 'paid' ? new Date() : undefined },
      });
    });
  }
}
