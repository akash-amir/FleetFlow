import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { EmailService } from '../../../common/email/email.service.js';
import { PortalAuthService } from './portal-auth.service.js';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function matches(entity: any, where: any = {}) {
  return Object.entries(where).every(([key, value]) => entity[key] === value);
}

/** In-memory stand-in for PrismaService's customerUser/customerRefreshToken/customerUserToken delegates. */
function createFakePrisma() {
  const customerUsers = new Map<number, any>();
  const refreshTokens = new Map<number, any>();
  const tokens = new Map<number, any>();
  let nextUserId = 1;
  let nextRefreshId = 1;
  let nextTokenId = 1;

  const fake: any = {
    customerUser: {
      findUnique: async ({ where }: any) =>
        where.id != null ? (customerUsers.get(where.id) ?? null) : ([...customerUsers.values()].find((u) => u.email === where.email) ?? null),
      update: async ({ where, data }: any) => {
        const user = customerUsers.get(where.id);
        Object.assign(user, data);
        return user;
      },
    },
    customerRefreshToken: {
      create: async ({ data }: any) => {
        const record = { id: nextRefreshId++, revokedAt: null, replacedByTokenId: null, createdAt: new Date(), ...data };
        refreshTokens.set(record.id, record);
        return record;
      },
      findUnique: async ({ where, include }: any) => {
        const record = [...refreshTokens.values()].find((r) => r.tokenHash === where.tokenHash);
        if (!record) return null;
        return include?.customerUser ? { ...record, customerUser: customerUsers.get(record.customerUserId) } : record;
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
    customerUserToken: {
      create: async ({ data }: any) => {
        const token = { id: nextTokenId++, usedAt: null, createdAt: new Date(), ...data };
        tokens.set(token.id, token);
        return token;
      },
      findUnique: async ({ where, include }: any) => {
        const token = [...tokens.values()].find((t) => t.tokenHash === where.tokenHash);
        if (!token) return null;
        return include?.customerUser ? { ...token, customerUser: customerUsers.get(token.customerUserId) } : token;
      },
      update: async ({ where, data }: any) => {
        const token = tokens.get(where.id);
        Object.assign(token, data);
        return token;
      },
    },
    $transaction: async (fn: any) => fn(fake),
    async addUser(overrides: Record<string, unknown> = {}) {
      const user = {
        id: nextUserId++,
        customerId: 1,
        fullName: 'Jane Contact',
        email: 'jane@client.test',
        passwordHash: await bcrypt.hash('correct-password', 4),
        isActive: true,
        createdAt: new Date(),
        ...overrides,
      };
      customerUsers.set(user.id, user);
      return user;
    },
    addToken(customerUserId: number, overrides: Record<string, unknown> = {}) {
      const token = {
        id: nextTokenId++,
        customerUserId,
        purpose: 'invite',
        usedAt: null,
        invalidatedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        ...overrides,
      };
      tokens.set(token.id, token);
      return token;
    },
    getRefreshTokensFor(customerUserId: number) {
      return [...refreshTokens.values()].filter((r) => r.customerUserId === customerUserId);
    },
  };
  return fake;
}

function createFakeEmail(): EmailService & { sent: any[] } {
  const sent: any[] = [];
  return {
    sent,
    async send(input) {
      sent.push(input);
    },
  };
}

describe('PortalAuthService', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let email: ReturnType<typeof createFakeEmail>;
  let service: PortalAuthService;

  beforeEach(() => {
    prisma = createFakePrisma();
    email = createFakeEmail();
    const customerJwt = new JwtService({ secret: 'test-customer-secret', signOptions: { expiresIn: '15m' } });
    service = new PortalAuthService(prisma as unknown as PrismaService, customerJwt, email);
  });

  describe('acceptInvite', () => {
    it('sets the password and marks the token used', async () => {
      const user = await prisma.addUser({ passwordHash: null });
      prisma.addToken(user.id, { tokenHash: hashToken('raw-invite-token') });

      await service.acceptInvite('raw-invite-token', 'brand-new-password');

      const updatedUser = await prisma.customerUser.findUnique({ where: { id: user.id } });
      expect(updatedUser.passwordHash).not.toBeNull();
      expect(await bcrypt.compare('brand-new-password', updatedUser.passwordHash)).toBe(true);

      const usedToken = await prisma.customerUserToken.findUnique({ where: { tokenHash: hashToken('raw-invite-token') } });
      expect(usedToken.usedAt).not.toBeNull();
    });

    it('rejects a token that is already used (single use)', async () => {
      const user = await prisma.addUser({ passwordHash: null });
      prisma.addToken(user.id, { tokenHash: hashToken('used-token'), usedAt: new Date() });
      await expect(service.acceptInvite('used-token', 'password123')).rejects.toThrow(BadRequestException);
    });

    it('rejects a token invalidated by a later resend, even though it was never used', async () => {
      const user = await prisma.addUser({ passwordHash: null });
      prisma.addToken(user.id, { tokenHash: hashToken('stale-token'), invalidatedAt: new Date() });
      await expect(service.acceptInvite('stale-token', 'password123')).rejects.toThrow(BadRequestException);
    });

    it('rejects an expired token', async () => {
      const user = await prisma.addUser({ passwordHash: null });
      prisma.addToken(user.id, { tokenHash: hashToken('expired-token'), expiresAt: new Date(Date.now() - 1000) });
      await expect(service.acceptInvite('expired-token', 'password123')).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown token with the same generic message', async () => {
      await expect(service.acceptInvite('never-issued', 'password123')).rejects.toThrow(BadRequestException);
    });
  });

  describe('login', () => {
    it('cannot log in before accepting the invite (passwordHash still null)', async () => {
      await prisma.addUser({ passwordHash: null });
      await expect(service.login('jane@client.test', 'anything')).rejects.toThrow(UnauthorizedException);
    });

    it('succeeds with the correct password', async () => {
      await prisma.addUser();
      const result = await service.login('jane@client.test', 'correct-password');
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it.each([
      ['unknown email', 'nobody@client.test', 'correct-password'],
      ['wrong password', 'jane@client.test', 'wrong-password'],
    ])('rejects %s with the same generic 401', async (_label, loginEmail, password) => {
      await prisma.addUser();
      await expect(service.login(loginEmail, password)).rejects.toThrow(UnauthorizedException);
    });

    it('a deactivated user cannot log in', async () => {
      await prisma.addUser({ isActive: false });
      await expect(service.login('jane@client.test', 'correct-password')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('a deactivated user cannot refresh', async () => {
      const user = await prisma.addUser();
      const { refreshToken } = await service.login('jane@client.test', 'correct-password');
      await prisma.customerUser.update({ where: { id: user.id }, data: { isActive: false } });
      await expect(service.refresh(refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('rotates the token and revokes the family on reuse', async () => {
      await prisma.addUser();
      const first = await service.login('jane@client.test', 'correct-password');
      const second = await service.refresh(first.refreshToken);
      expect(second.refreshToken).not.toBe(first.refreshToken);

      // Replaying the already-rotated-away token trips reuse detection...
      await expect(service.refresh(first.refreshToken)).rejects.toThrow(/reuse detected/i);
      // ...and revokes the whole family, including the currently-valid token.
      await expect(service.refresh(second.refreshToken)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('forgotPassword', () => {
    it('sends an email for a known, active user', async () => {
      await prisma.addUser();
      await service.forgotPassword('jane@client.test');
      expect(email.sent).toHaveLength(1);
    });

    it('does not send anything, and does not throw, for an unknown email', async () => {
      await expect(service.forgotPassword('nobody@client.test')).resolves.toBeUndefined();
      expect(email.sent).toHaveLength(0);
    });

    it('does not send anything for a deactivated user', async () => {
      await prisma.addUser({ isActive: false });
      await service.forgotPassword('jane@client.test');
      expect(email.sent).toHaveLength(0);
    });
  });

  describe('resetPassword', () => {
    it('sets the new password, is single use, and revokes all sessions', async () => {
      const user = await prisma.addUser();
      const { refreshToken } = await service.login('jane@client.test', 'correct-password');
      const rawResetToken = 'raw-reset-token';
      prisma.addToken(user.id, { tokenHash: hashToken(rawResetToken), purpose: 'password_reset' });

      await service.resetPassword(rawResetToken, 'another-new-password');

      const updated = await prisma.customerUser.findUnique({ where: { id: user.id } });
      expect(await bcrypt.compare('another-new-password', updated.passwordHash)).toBe(true);

      // Single use: the same token can't be used again.
      await expect(service.resetPassword(rawResetToken, 'yet-another-password')).rejects.toThrow(BadRequestException);

      // All sessions revoked: the pre-reset refresh token is now dead.
      await expect(service.refresh(refreshToken)).rejects.toThrow(UnauthorizedException);
    });
  });
});
