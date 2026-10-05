import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { PaginatedResult } from '../../../common/pagination.js';
import { CreatePortalOrderDto } from '../dto/create-portal-order.dto.js';
import { ListPortalOrdersQueryDto } from '../dto/list-portal-orders.query.dto.js';
import { PortalOrderDetailResponseDto, PortalOrderResponseDto } from '../dto/portal-order-response.dto.js';

const SHIPMENT_SUMMARY_INCLUDE = {
  shipment: {
    select: {
      status: true,
      pickedUpAt: true,
      deliveredAt: true,
      proofOfDelivery: { select: { photoUrl: true, signatureUrl: true, notes: true } },
    },
  },
} as const;

@Injectable()
export class PortalOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(customerId: number, customerUserId: number, dto: CreatePortalOrderDto): Promise<PortalOrderResponseDto> {
    const order = await this.prisma.order.create({
      data: {
        customerId,
        createdByCustomerUserId: customerUserId,
        pickupAddress: dto.pickupAddress,
        deliveryAddress: dto.deliveryAddress,
        itemDescription: dto.itemDescription,
        declaredAmount: dto.declaredAmount,
      },
    });
    return PortalOrderResponseDto.fromEntity(order);
  }

  async findAll(customerId: number, query: ListPortalOrdersQueryDto): Promise<PaginatedResult<PortalOrderResponseDto>> {
    const where: Prisma.OrderWhereInput = {
      customerId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { id: 'asc' },
      }),
      this.prisma.order.count({ where }),
    ]);

    return { data: data.map((order) => PortalOrderResponseDto.fromEntity(order)), meta: { page: query.page, limit: query.limit, total } };
  }

  async findOne(customerId: number, id: number): Promise<PortalOrderDetailResponseDto> {
    const order = await this.prisma.order.findFirst({
      where: { id, customerId },
      include: SHIPMENT_SUMMARY_INCLUDE,
    });
    // Belongs to another customer or doesn't exist — both look identical
    // from this customer's point of view, so both are 404.
    if (!order) throw new NotFoundException('Order not found');
    return PortalOrderDetailResponseDto.fromEntityWithShipment(order);
  }

  async cancel(customerId: number, id: number): Promise<PortalOrderResponseDto> {
    const order = await this.prisma.order.findFirst({ where: { id, customerId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'pending') {
      throw new ConflictException(`Only a pending order can be cancelled (current status: ${order.status})`);
    }
    const updated = await this.prisma.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
    return PortalOrderResponseDto.fromEntity(updated);
  }
}
