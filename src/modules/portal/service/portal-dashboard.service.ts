import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { PortalDashboardResponseDto } from '../dto/portal-dashboard-response.dto.js';

const ACTIVE_SHIPMENT_STATUSES = ['ready_for_dispatch', 'picked_up', 'in_transit'] as const;

@Injectable()
export class PortalDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(customerId: number): Promise<PortalDashboardResponseDto> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [activeShipments, deliveredThisMonth, unpaidInvoices, overdueInvoiceCount] = await Promise.all([
      this.prisma.shipment.count({
        where: { order: { customerId }, status: { in: [...ACTIVE_SHIPMENT_STATUSES] } },
      }),
      this.prisma.shipment.count({
        where: { order: { customerId }, status: 'delivered', deliveredAt: { gte: startOfMonth } },
      }),
      this.prisma.invoice.findMany({
        where: { shipment: { order: { customerId } }, status: { not: 'paid' } },
        select: { amount: true, payments: { select: { amountPaid: true } } },
      }),
      this.prisma.invoice.count({
        where: { shipment: { order: { customerId } }, status: { not: 'paid' }, dueDate: { lt: now } },
      }),
    ]);

    const totalOutstandingBalance = unpaidInvoices.reduce((sum, invoice) => {
      const paid = invoice.payments.reduce((s, p) => s.plus(p.amountPaid), new Prisma.Decimal(0));
      return sum.plus(invoice.amount.minus(paid));
    }, new Prisma.Decimal(0));

    return {
      activeShipments,
      deliveredThisMonth,
      unpaidInvoiceCount: unpaidInvoices.length,
      totalOutstandingBalance,
      overdueInvoiceCount,
    };
  }
}
