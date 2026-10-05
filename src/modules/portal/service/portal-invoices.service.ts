import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { PaginatedResult } from '../../../common/pagination.js';
import { ListPortalInvoicesQueryDto } from '../dto/list-portal-invoices.query.dto.js';
import { PortalInvoiceResponseDto } from '../dto/portal-invoice-response.dto.js';

const PAYMENTS_INCLUDE = {
  payments: { orderBy: { paidAt: 'asc' as const }, select: { amountPaid: true, method: true, paidAt: true } },
} as const;

@Injectable()
export class PortalInvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(customerId: number, query: ListPortalInvoicesQueryDto): Promise<PaginatedResult<PortalInvoiceResponseDto>> {
    const conditions: Prisma.InvoiceWhereInput[] = [{ shipment: { order: { customerId } } }];
    if (query.status) conditions.push({ status: query.status });
    if (query.overdue) conditions.push({ dueDate: { lt: new Date() }, status: { not: 'paid' } });
    const where: Prisma.InvoiceWhereInput = { AND: conditions };

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: PAYMENTS_INCLUDE,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { id: 'asc' },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      data: data.map((invoice) => PortalInvoiceResponseDto.fromEntity(invoice)),
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  async findOne(customerId: number, id: number): Promise<PortalInvoiceResponseDto> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, shipment: { order: { customerId } } },
      include: PAYMENTS_INCLUDE,
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return PortalInvoiceResponseDto.fromEntity(invoice);
  }
}
