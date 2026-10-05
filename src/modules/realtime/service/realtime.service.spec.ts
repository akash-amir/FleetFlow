import { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { RealtimeService, OPS_ROOM, driverRoom, customerRoom, msUntilExpiry } from './realtime.service.js';

function createFakePrisma(users: Map<number, any>, customerUsers: Map<number, any> = new Map()) {
  return {
    user: {
      findUnique: async ({ where }: any) => users.get(where.id) ?? null,
    },
    customerUser: {
      findUnique: async ({ where }: any) => customerUsers.get(where.id) ?? null,
    },
  } as unknown as PrismaService;
}

describe('RealtimeService.getRoomsForRole', () => {
  const staffJwt = new JwtService({ secret: 'test-secret' });
  const customerJwt = new JwtService({ secret: 'test-customer-secret' });
  const service = new RealtimeService(staffJwt, customerJwt, createFakePrisma(new Map()));

  it('puts admin and dispatcher in the ops room', () => {
    expect(service.getRoomsForRole('admin', 1)).toEqual([OPS_ROOM]);
    expect(service.getRoomsForRole('dispatcher', 2)).toEqual([OPS_ROOM]);
  });

  it('puts a driver in their own driver room only', () => {
    expect(service.getRoomsForRole('driver', 7)).toEqual([driverRoom(7)]);
  });
});

describe('RealtimeService.authenticateSocket', () => {
  const staffJwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '15m' } });
  const customerJwt = new JwtService({ secret: 'test-customer-secret', signOptions: { expiresIn: '15m' } });
  const users = new Map<number, any>([
    [1, { id: 1, role: 'admin', isActive: true }],
    [4, { id: 4, role: 'driver', isActive: false }],
  ]);
  const customerUsers = new Map<number, any>([
    [10, { id: 10, customerId: 100, isActive: true }],
    [11, { id: 11, customerId: 101, isActive: false }],
  ]);
  const service = new RealtimeService(staffJwt, customerJwt, createFakePrisma(users, customerUsers));

  it('rejects a missing token', async () => {
    expect(await service.authenticateSocket(undefined)).toBeNull();
  });

  it('rejects a garbage token', async () => {
    expect(await service.authenticateSocket('not-a-real-token')).toBeNull();
  });

  it('rejects a valid staff token for a user that no longer exists', async () => {
    const token = await staffJwt.signAsync({ sub: 999, email: 'ghost@example.com', role: 'admin' });
    expect(await service.authenticateSocket(token)).toBeNull();
  });

  it('rejects a valid staff token for an inactive user', async () => {
    const token = await staffJwt.signAsync({ sub: 4, email: 'x@example.com', role: 'driver' });
    expect(await service.authenticateSocket(token)).toBeNull();
  });

  it('accepts a valid token for an active user and returns the right rooms', async () => {
    const token = await staffJwt.signAsync({ sub: 1, email: 'x@example.com', role: 'admin' });
    const identity = await service.authenticateSocket(token);
    expect(identity).not.toBeNull();
    expect(identity).toMatchObject({ kind: 'staff', userId: 1, rooms: [OPS_ROOM] });
    expect(identity!.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('accepts a valid customer token for an active customer user and joins their customer room', async () => {
    const token = await customerJwt.signAsync({ sub: 10, customerId: 100, type: 'customer' });
    const identity = await service.authenticateSocket(token);
    expect(identity).not.toBeNull();
    expect(identity).toMatchObject({ kind: 'customer', customerId: 100, rooms: [customerRoom(100)] });
    expect(identity!.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('rejects a customer token for an inactive customer user', async () => {
    const token = await customerJwt.signAsync({ sub: 11, customerId: 101, type: 'customer' });
    expect(await service.authenticateSocket(token)).toBeNull();
  });

  it('rejects a customer token for a customer user that no longer exists', async () => {
    const token = await customerJwt.signAsync({ sub: 999, customerId: 1, type: 'customer' });
    expect(await service.authenticateSocket(token)).toBeNull();
  });

  it('rejects a staff-secret token on the customer branch and vice versa', async () => {
    // Signed with the staff secret but shaped like a customer token — wrong
    // key, so it fails staff verification (type check) and fails customer
    // verification (signature itself is invalid under that secret).
    const crossSigned = await staffJwt.signAsync({ sub: 10, customerId: 100, type: 'customer' });
    expect(await service.authenticateSocket(crossSigned)).toBeNull();
  });
});

describe('msUntilExpiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes the exact remaining time when exp is in the future', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const expiresAtSeconds = new Date('2026-01-01T00:00:05.000Z').getTime() / 1000;
    expect(msUntilExpiry(expiresAtSeconds)).toBe(5000);
  });

  it('clamps to 0 for an exp already in the past — never a negative delay', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'));
    const expiresAtSeconds = new Date('2026-01-01T00:00:00.000Z').getTime() / 1000;
    expect(msUntilExpiry(expiresAtSeconds)).toBe(0);
  });
});
