import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { CustomersService } from './customers.service.js';

/** In-memory stand-in for PrismaService's `customer` delegate — enough for CustomersService, no live DB needed. */
function createFakePrisma() {
  const customers = new Map<number, any>();
  let nextId = 1;

  function assertEmailFree(email: string, excludeId?: number) {
    const clash = [...customers.values()].find((c) => c.email === email && c.id !== excludeId);
    if (clash) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
    }
  }

  return {
    customer: {
      create: async ({ data }: any) => {
        assertEmailFree(data.email);
        const customer = { id: nextId++, createdAt: new Date(), ...data };
        customers.set(customer.id, customer);
        return customer;
      },
      findUnique: async ({ where }: any) => customers.get(where.id) ?? null,
      update: async ({ where, data }: any) => {
        if (data.email) assertEmailFree(data.email, where.id);
        const customer = customers.get(where.id);
        Object.assign(customer, data);
        return customer;
      },
    },
  };
}

describe('CustomersService', () => {
  let service: CustomersService;

  beforeEach(() => {
    const prisma = createFakePrisma();
    service = new CustomersService(prisma as unknown as PrismaService);
  });

  it('creates a customer', async () => {
    const customer = await service.create({ companyName: 'Acme Logistics', email: 'ops@acme.test' });
    expect(customer.id).toBeDefined();
    expect(customer.companyName).toBe('Acme Logistics');
  });

  it('returns 409 (ConflictException) on a duplicate email', async () => {
    await service.create({ companyName: 'Acme Logistics', email: 'ops@acme.test' });
    await expect(service.create({ companyName: 'Other Co', email: 'ops@acme.test' })).rejects.toThrow(ConflictException);
  });
});
