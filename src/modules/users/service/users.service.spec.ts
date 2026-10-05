import { JwtService } from '@nestjs/jwt';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { AuthService } from '../../auth/service/auth.service.js';
import { UsersService } from './users.service.js';
import { CreatableRole } from '../dto/create-user.dto.js';

/**
 * In-memory stand-in for PrismaService covering user/driverProfile/refreshToken
 * (only what UsersService + the real AuthService touch). Real bcrypt and a
 * real AuthService run on top of it, so "deactivate revokes tokens" exercises
 * the actual revocation code, not a mock of it — without needing a live DB.
 */
function createFakePrisma() {
  const users = new Map<number, any>();
  const driverProfiles = new Map<number, any>(); // keyed by driverId
  const refreshTokens = new Map<number, any>();
  let nextUserId = 1;
  let nextTokenId = 1;

  function assertEmailFree(email: string, excludeId?: number) {
    const clash = [...users.values()].find((u) => u.email === email && u.id !== excludeId);
    if (clash) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      });
    }
  }

  function matches(user: any, where: any = {}) {
    return Object.entries(where).every(([key, value]) => user[key] === value);
  }

  const fake: any = {
    user: {
      create: async ({ data }: any) => {
        assertEmailFree(data.email);
        const user = { isActive: true, createdAt: new Date(), id: nextUserId++, ...data };
        users.set(user.id, user);
        return user;
      },
      findUnique: async ({ where, include }: any) => {
        const user = where.id != null ? users.get(where.id) : [...users.values()].find((u) => u.email === where.email);
        if (!user) return null;
        return include?.driverProfile ? { ...user, driverProfile: driverProfiles.get(user.id) ?? null } : user;
      },
      findMany: async ({ where, include, skip = 0, take = Infinity }: any) => {
        const list = [...users.values()]
          .filter((u) => matches(u, where))
          .slice(skip, skip + take);
        return include?.driverProfile ? list.map((u) => ({ ...u, driverProfile: driverProfiles.get(u.id) ?? null })) : list;
      },
      count: async ({ where }: any) => [...users.values()].filter((u) => matches(u, where)).length,
      update: async ({ where, data }: any) => {
        const user = users.get(where.id);
        if (data.email) assertEmailFree(data.email, where.id);
        Object.assign(user, data);
        return user;
      },
    },
    driverProfile: {
      create: async ({ data }: any) => {
        const profile = { licenseNumber: null, vehicleId: null, availabilityStatus: 'available', ...data };
        driverProfiles.set(profile.driverId, profile);
        return profile;
      },
      update: async ({ where, data }: any) => {
        const profile = driverProfiles.get(where.driverId);
        Object.assign(profile, data);
        return profile;
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
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const record of refreshTokens.values()) {
          const matchesId = where.id === undefined || record.id === where.id;
          const matchesUser = where.userId === undefined || record.userId === where.userId;
          const matchesFamily = where.familyId === undefined || record.familyId === where.familyId;
          const matchesRevoked = where.revokedAt === undefined || record.revokedAt === where.revokedAt;
          if (matchesId && matchesUser && matchesFamily && matchesRevoked) {
            Object.assign(record, data);
            count++;
          }
        }
        return { count };
      },
    },
    $transaction: async (fn: any) => fn(fake),
  };
  return fake;
}

describe('UsersService', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let usersService: UsersService;
  let authService: AuthService;

  beforeEach(() => {
    prisma = createFakePrisma();
    const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '15m' } });
    authService = new AuthService(prisma as unknown as PrismaService, jwt);
    usersService = new UsersService(prisma as unknown as PrismaService, authService);
  });

  it('creates a driver and its DriverProfile', async () => {
    const result = await usersService.create({
      fullName: 'Dana Driver',
      email: 'dana@fleetflow.local',
      password: 'password123',
      role: CreatableRole.driver,
      licenseNumber: 'LIC-42',
    });

    expect(result.role).toBe('driver');
    expect(result.licenseNumber).toBe('LIC-42');
  });

  it('returns 409 (ConflictException) on a duplicate email', async () => {
    const dto = {
      fullName: 'Dana Driver',
      email: 'dana@fleetflow.local',
      password: 'password123',
      role: CreatableRole.driver,
    };
    await usersService.create(dto);
    await expect(usersService.create({ ...dto, fullName: 'Someone Else' })).rejects.toThrow(ConflictException);
  });

  it('revokes refresh tokens when a user is deactivated', async () => {
    const created = await usersService.create({
      fullName: 'Dana Driver',
      email: 'dana@fleetflow.local',
      password: 'password123',
      role: CreatableRole.driver,
    });
    await prisma.refreshToken.create({
      data: { userId: created.id, familyId: 'fam-1', tokenHash: 'hash-1', expiresAt: new Date(Date.now() + 1000) },
    });

    await usersService.setActive(created.id, false, 999);

    const token = await prisma.refreshToken.findUnique({ where: { tokenHash: 'hash-1' } });
    expect(token.revokedAt).not.toBeNull();
  });

  it('refuses to let a caller deactivate their own account', async () => {
    // The self-check is purely id === currentUserId, so any seeded user works
    // here to stand in for "the admin who is currently logged in".
    const staff = await usersService.create({
      fullName: 'Sam Staff',
      email: 'sam@fleetflow.local',
      password: 'password123',
      role: CreatableRole.dispatcher,
    });

    await expect(usersService.setActive(staff.id, false, staff.id)).rejects.toThrow(ForbiddenException);
  });
});
