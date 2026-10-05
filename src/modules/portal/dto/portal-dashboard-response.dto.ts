import type { Prisma } from '@prisma/client';

export class PortalDashboardResponseDto {
  activeShipments!: number;
  deliveredThisMonth!: number;
  unpaidInvoiceCount!: number;
  totalOutstandingBalance!: Prisma.Decimal;
  overdueInvoiceCount!: number;
}
