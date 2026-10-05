import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { OrdersService } from './orders.service.js';

/** In-memory stand-in for PrismaService's `customer`/`order` delegates — enough for OrdersService, no live DB needed. */
function createFakePrisma() {
  const customers = new Map<number, any>();
  const orders = new Map<number, any>();
  let nextCustomerId = 1;
  let nextOrderId = 1;

  return {
    customer: {
      findUnique: async ({ where }: any) => customers.get(where.id) ?? null,
    },
    order: {
      create: async ({ data }: any) => {
        const order = { id: nextOrderId++, status: 'pending', createdAt: new Date(), ...data };
        orders.set(order.id, order);
        return order;
      },
      findUnique: async ({ where }: any) => orders.get(where.id) ?? null,
      update: async ({ where, data }: any) => {
        const order = orders.get(where.id);
        Object.assign(order, data);
        return order;
      },
    },
    async addCustomer() {
      const customer = { id: nextCustomerId++, companyName: 'Acme', email: `acme${nextCustomerId}@test.com`, createdAt: new Date() };
      customers.set(customer.id, customer);
      return customer;
    },
  };
}

describe('OrdersService', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let service: OrdersService;

  beforeEach(() => {
    prisma = createFakePrisma();
    service = new OrdersService(prisma as unknown as PrismaService);
  });

  it('creates an order for an existing customer', async () => {
    const customer = await prisma.addCustomer();
    const order = await service.create({
      customerId: customer.id,
      pickupAddress: '1 A St',
      deliveryAddress: '2 B St',
      deliveryFee: 49.99,
    });
    expect(order.status).toBe('pending');
    expect(order.customerId).toBe(customer.id);
  });

  it('returns 404 (NotFoundException) for a missing customer', async () => {
    await expect(
      service.create({ customerId: 999, pickupAddress: '1 A St', deliveryAddress: '2 B St', deliveryFee: 10 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns 409 (ConflictException) editing a non-pending order', async () => {
    const customer = await prisma.addCustomer();
    const order = await service.create({
      customerId: customer.id,
      pickupAddress: '1 A St',
      deliveryAddress: '2 B St',
      deliveryFee: 10,
    });
    await prisma.order.update({ where: { id: order.id }, data: { status: 'processing' } });

    await expect(service.update(order.id, { deliveryFee: 20 })).rejects.toThrow(ConflictException);
  });

  it('returns 409 (ConflictException) cancelling a non-pending order', async () => {
    const customer = await prisma.addCustomer();
    const order = await service.create({
      customerId: customer.id,
      pickupAddress: '1 A St',
      deliveryAddress: '2 B St',
      deliveryFee: 10,
    });
    await prisma.order.update({ where: { id: order.id }, data: { status: 'processing' } });

    await expect(service.cancel(order.id)).rejects.toThrow(ConflictException);
  });
});
