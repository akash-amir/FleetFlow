import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { PaginatedResult } from '../../../common/pagination.js';
import { ListPortalShipmentsQueryDto } from '../dto/list-portal-shipments.query.dto.js';
import { PortalShipmentResponseDto } from '../dto/portal-shipment-response.dto.js';

const SHIPMENT_DETAIL_INCLUDE = {
  order: { select: { id: true, pickupAddress: true, deliveryAddress: true, status: true } },
  driver: { select: { fullName: true } },
  proofOfDelivery: { select: { photoUrl: true, signatureUrl: true, notes: true } },
  // status + timestamp only — never changedById, fromStatus, or the row id.
  statusHistory: { orderBy: { createdAt: 'asc' as const }, select: { toStatus: true, createdAt: true } },
} as const;

@Injectable()
export class PortalShipmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(customerId: number, query: ListPortalShipmentsQueryDto): Promise<PaginatedResult<PortalShipmentResponseDto>> {
    const where: Prisma.ShipmentWhereInput = {
      order: { customerId },
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        include: SHIPMENT_DETAIL_INCLUDE,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { id: 'asc' },
      }),
      this.prisma.shipment.count({ where }),
    ]);

    return {
      data: data.map((shipment) => PortalShipmentResponseDto.fromEntity(shipment)),
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  async findOne(customerId: number, id: number): Promise<PortalShipmentResponseDto> {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id, order: { customerId } },
      include: SHIPMENT_DETAIL_INCLUDE,
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    return PortalShipmentResponseDto.fromEntity(shipment);
  }
}
