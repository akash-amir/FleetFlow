import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

/**
 * In-memory stand-in for PrismaService covering only what AuthService uses
 * (user + refreshToken delegates, $transaction). Keeps these tests real
 * (real bcrypt, real crypto, real rotation/reuse logic) without needing a
 * live Postgres to run `npm test`.
 */
function createFakePrisma() {
  const users = new Map<number, any>();
  const refreshTokens = new Map<number, any>();
  let nextUserId = 1;
  let nextTokenId = 1;

  const fake = {
    user: {
      findUnique: async ({ where }: any) => {
        if (where.id != null) return users.get(where.id) ?? null;
        return [...users.values()].find((u) => u.email === where.email) ?? null;
      },
    },
    refreshToken: {
      create: async ({ data }: any) => {
        const record = { id: nextTokenId++, revokedAt: null, replacedByTokenId: null, createdAt: new Date(), ...data };
        refreshTokens.set(record.id, record);
        return record;
      },
      findUnique: async ({ where, include }: any) => {
        const record = [...refreshTokens.values()].find((t) => t.tokenHash === where.tokenHash);
        if (!record) return null;
        return include?.user ? { ...record, user: users.get(record.userId) } : record;
      },
      update: async ({ where, data }: any) => {
        const record = refreshTokens.get(where.id);
        Object.assign(record, data);
        return record;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const record of refreshTokens.values()) {
          const matchesId = where.id === undefined || record.id === where.id;
          const matchesFamily = where.familyId === undefined || record.familyId === where.familyId;
          const matchesRevoked = where.revokedAt === undefined || record.revokedAt === where.revokedAt;
          if (matchesId && matchesFamily && matchesRevoked) {
            Object.assign(record, data);
            count++;
          }
        }
        return { count };
      },
    },
    $transaction: async (fn: any) => fn(fake),
    async addUser(overrides: Partial<{ email: string; passwordHash: string; role: string; isActive: boolean }>) {
      const user = {
        id: nextUserId++,
        fullName: 'Test User',
        email: 'user@example.com',
        passwordHash: await bcrypt.hash('correct-password', 4),
        role: 'admin',
        isActive: true,
        createdAt: new Date(),
        ...overrides,
      };
      users.set(user.id, user);
      return user;
    },
  };
  return fake;
}

describe('AuthService', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let service: AuthService;

  beforeEach(() => {
    prisma = createFakePrisma();
    const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '15m' } });
    service = new AuthService(prisma as unknown as PrismaService, jwt);
  });

  it('logs in successfully with correct credentials', async () => {
    const user = await prisma.addUser({ email: 'admin@fleetflow.local' });
    const result = await service.login(user.email, 'correct-password');

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.user.email).toBe(user.email);
    expect((result.user as any).passwordHash).toBeUndefined();
  });

  it('rejects login with the wrong password', async () => {
    const user = await prisma.addUser({ email: 'admin@fleetflow.local' });
    await expect(service.login(user.email, 'wrong-password')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects login for an inactive user', async () => {
    const user = await prisma.addUser({ email: 'inactive@fleetflow.local', isActive: false });
    await expect(service.login(user.email, 'correct-password')).rejects.toThrow(UnauthorizedException);
  });

  it('rotates the refresh token on refresh, invalidating the old one', async () => {
    const user = await prisma.addUser({ email: 'admin@fleetflow.local' });
    const first = await service.login(user.email, 'correct-password');

    const second = await service.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.accessToken).toBeTruthy();

    // The old token is now revoked and can't be used again.
    await expect(service.refresh(first.refreshToken)).rejects.toThrow(/reuse detected/i);
  });

  it('revokes the entire token family when a revoked refresh token is replayed', async () => {
    const user = await prisma.addUser({ email: 'admin@fleetflow.local' });
    const first = await service.login(user.email, 'correct-password');
    const second = await service.refresh(first.refreshToken); // rotates first -> second

    // Replaying the already-used first token trips reuse detection...
    await expect(service.refresh(first.refreshToken)).rejects.toThrow(/reuse detected/i);

    // ...and the legitimate, still-current second token is now dead too,
    // because reuse detection revokes the whole family, not just the replay.
    await expect(service.refresh(second.refreshToken)).rejects.toThrow(UnauthorizedException);
  });
});
