import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { EmailService } from '../../../common/email/email.service.js';
import { CustomerUsersService } from './customer-users.service.js';

function matches(entity: any, where: any = {}) {
  return Object.entries(where).every(([key, value]) => entity[key] === value);
}

/** In-memory stand-in for PrismaService's customer/customerUser/customerUserToken/customerRefreshToken delegates. */
function createFakePrisma() {
  const customers = new Map<number, any>();
  const customerUsers = new Map<number, any>();
  const tokens = new Map<number, any>();
  const refreshTokens = new Map<number, any>();
  let nextCustomerId = 1;
  let nextUserId = 1;
  let nextTokenId = 1;
  let nextRefreshId = 1;

  const fake: any = {
    customer: {
      findUnique: async ({ where }: any) => customers.get(where.id) ?? null,
    },
    customerUser: {
      create: async ({ data }: any) => {
        const clash = [...customerUsers.values()].some((u) => u.email === data.email);
        if (clash) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        }
        const user = { id: nextUserId++, passwordHash: null, isActive: true, createdAt: new Date(), ...data };
        customerUsers.set(user.id, user);
        return user;
      },
      findUnique: async ({ where }: any) =>
        where.id != null ? (customerUsers.get(where.id) ?? null) : ([...customerUsers.values()].find((u) => u.email === where.email) ?? null),
      findMany: async ({ where, skip = 0, take = Infinity }: any) =>
        [...customerUsers.values()].filter((u) => matches(u, where)).slice(skip, skip + take),
      count: async ({ where }: any) => [...customerUsers.values()].filter((u) => matches(u, where)).length,
      update: async ({ where, data }: any) => {
        const user = customerUsers.get(where.id);
        Object.assign(user, data);
        return user;
      },
    },
    customerUserToken: {
      create: async ({ data }: any) => {
        const token = { id: nextTokenId++, usedAt: null, invalidatedAt: null, createdAt: new Date(), ...data };
        tokens.set(token.id, token);
        return token;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const token of tokens.values()) {
          if (matches(token, where)) {
            Object.assign(token, data);
            count++;
          }
        }
        return { count };
      },
    },
    customerRefreshToken: {
      create: async ({ data }: any) => {
        const record = { id: nextRefreshId++, revokedAt: null, createdAt: new Date(), ...data };
        refreshTokens.set(record.id, record);
        return record;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const record of refreshTokens.values()) {
          if (matches(record, where)) {
            Object.assign(record, data);
            count++;
          }
        }
        return { count };
      },
    },
    $transaction: async (fn: any) => fn(fake),
    addCustomer(overrides: Record<string, unknown> = {}) {
      const customer = { id: nextCustomerId++, companyName: 'Acme', email: `acme${nextCustomerId}@test.com`, createdAt: new Date(), ...overrides };
      customers.set(customer.id, customer);
      return customer;
    },
    getRefreshTokensFor(customerUserId: number) {
      return [...refreshTokens.values()].filter((r) => r.customerUserId === customerUserId);
    },
    getTokensFor(customerUserId: number) {
      return [...tokens.values()].filter((t) => t.customerUserId === customerUserId);
    },
  };
  return fake;
}

function createFakeEmail() {
  const sent: any[] = [];
  let nextSendShouldFail = false;
  const service: EmailService & { sent: any[]; failNextSend(): void } = {
    sent,
    failNextSend() {
      nextSendShouldFail = true;
    },
    async send(input) {
      if (nextSendShouldFail) {
        nextSendShouldFail = false;
        throw new Error('simulated email failure');
      }
      sent.push(input);
    },
  };
  return service;
}

describe('CustomerUsersService', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let email: ReturnType<typeof createFakeEmail>;
  let service: CustomerUsersService;

  beforeEach(() => {
    prisma = createFakePrisma();
    email = createFakeEmail();
    service = new CustomerUsersService(prisma as unknown as PrismaService, email);
  });

  it('invites a customer user and emails an accept-invite link', async () => {
    const customer = prisma.addCustomer();
    const result = await service.invite(customer.id, { fullName: 'Jane Contact', email: 'jane@client.test' });

    expect(result.email).toBe('jane@client.test');
    expect(result.accepted).toBe(false);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].to).toBe('jane@client.test');
    expect(email.sent[0].text).toMatch(/\/portal\/accept-invite\?token=[0-9a-f]{64}/);
  });

  it('rejects inviting to a customer that does not exist', async () => {
    await expect(service.invite(999, { fullName: 'Jane', email: 'jane@client.test' })).rejects.toThrow(NotFoundException);
  });

  it('returns 409 (ConflictException) on a duplicate email', async () => {
    const customer = prisma.addCustomer();
    await service.invite(customer.id, { fullName: 'Jane', email: 'jane@client.test' });
    await expect(service.invite(customer.id, { fullName: 'Someone Else', email: 'jane@client.test' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('does not let a failed invite email block the invite itself', async () => {
    const customer = prisma.addCustomer();
    email.failNextSend();
    const result = await service.invite(customer.id, { fullName: 'Jane', email: 'jane@client.test' });
    expect(result.email).toBe('jane@client.test'); // still created despite the email failure
  });

  it('list responses use the shared paginated shape and never include passwordHash', async () => {
    const customer = prisma.addCustomer();
    await service.invite(customer.id, { fullName: 'Jane', email: 'jane@client.test' });
    const result = await service.findAllForCustomer(customer.id, { page: 1, limit: 20 });
    expect(result.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(result.data).toHaveLength(1);
    expect((result.data[0] as any).passwordHash).toBeUndefined();
  });

  it('resend-invite invalidates the previous unused invite token via invalidatedAt, not usedAt', async () => {
    const customer = prisma.addCustomer();
    await service.invite(customer.id, { fullName: 'Jane', email: 'jane@client.test' });
    const firstLink = email.sent[0].text.match(/token=([0-9a-f]{64})/)![1];

    await service.resendInvite(customer.id, 1);
    const secondLink = email.sent[1].text.match(/token=([0-9a-f]{64})/)![1];

    expect(secondLink).not.toBe(firstLink);

    const tokens = prisma.getTokensFor(1);
    const oldToken = tokens.find((t: any) => t.purpose === 'invite' && t !== tokens[tokens.length - 1]);
    expect(oldToken.invalidatedAt).toBeInstanceOf(Date);
    expect(oldToken.usedAt).toBeNull(); // invalidation is distinct from redemption
    // accept-invite rejects an invalidated token too (proven in portal-auth.service.spec.ts).
  });

  it('rejects resend-invite once the user has already accepted', async () => {
    const customer = prisma.addCustomer();
    await service.invite(customer.id, { fullName: 'Jane', email: 'jane@client.test' });
    await prisma.customerUser.update({ where: { id: 1 }, data: { passwordHash: 'already-set' } });

    await expect(service.resendInvite(customer.id, 1)).rejects.toThrow(ConflictException);
  });

  it('deactivating a customer user revokes their refresh tokens', async () => {
    const customer = prisma.addCustomer();
    await service.invite(customer.id, { fullName: 'Jane', email: 'jane@client.test' });
    await prisma.customerRefreshToken.create({
      data: { customerUserId: 1, familyId: 'fam-1', tokenHash: 'hash-1', expiresAt: new Date(Date.now() + 1000) },
    });

    await service.setActive(customer.id, 1, false);

    const tokens = prisma.getRefreshTokensFor(1);
    expect(tokens.every((t: any) => t.revokedAt !== null)).toBe(true);
  });
});
