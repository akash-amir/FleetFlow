import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Order, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { PaginatedResult } from '../../../common/pagination.js';
import { CreateOrderDto } from '../dto/create-order.dto.js';
import { UpdateOrderDto } from '../dto/update-order.dto.js';
import { ListOrdersQueryDto } from '../dto/list-orders.query.dto.js';

// Decimal fields (declaredAmount, deliveryFee) come back from Prisma as
// Decimal.js instances, whose toJSON() aliases toString() — so Nest's
// JSON.stringify serializes them as STRINGS (e.g. "49.99"), not numbers.
// Chosen deliberately over numbers: it avoids silent float rounding on
// the client for money values. Every money field in this API follows
// this same string convention.

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOrderDto): Promise<Order> {
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) throw new NotFoundException('Customer not found');

    return this.prisma.order.create({
      data: {
        customerId: dto.customerId,
        pickupAddress: dto.pickupAddress,
        deliveryAddress: dto.deliveryAddress,
        itemDescription: dto.itemDescription,
        declaredAmount: dto.declaredAmount,
        deliveryFee: dto.deliveryFee,
      },
    });
  }

  async findAll(query: ListOrdersQueryDto): Promise<PaginatedResult<Order>> {
    const where: Prisma.OrderWhereInput = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
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

    return { data, meta: { page: query.page, limit: query.limit, total } };
  }

  async findOne(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { customer: { select: { id: true, companyName: true, email: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async update(id: number, dto: UpdateOrderDto): Promise<Order> {
    const order = await this.assertPending(id, 'edited');
    return this.prisma.order.update({ where: { id: order.id }, data: dto });
  }

  async cancel(id: number): Promise<Order> {
    const order = await this.assertPending(id, 'cancelled');
    return this.prisma.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
  }

  private async assertPending(id: number, action: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'pending') {
      throw new ConflictException(`Only a pending order can be ${action} (current status: ${order.status})`);
    }
    return order;
  }
}
