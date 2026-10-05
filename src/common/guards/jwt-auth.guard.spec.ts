import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { CUSTOMER_ONLY_KEY } from '../decorators/customer-only.decorator.js';

const STAFF_SECRET = 'staff-test-secret';
const CUSTOMER_SECRET = 'customer-test-secret';

function fakeReflector(metadata: Record<string, unknown> = {}) {
  return { getAllAndOverride: (key: string) => metadata[key] } as unknown as Reflector;
}

function httpContext(headers: Record<string, string> = {}) {
  const request: any = { headers };
  return {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

// switchToHttp() throws here on purpose: if the guard ever reached into
// request-shape logic for a non-HTTP context, this test would fail loudly
// instead of silently passing on a lucky shape coincidence.
function wsContext() {
  return {
    getType: () => 'ws',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => {
      throw new Error('must not be called for a non-HTTP context');
    },
  } as any;
}

describe('JwtAuthGuard', () => {
  const staffJwt = new JwtService({ secret: STAFF_SECRET, signOptions: { expiresIn: '15m' } });
  const customerJwt = new JwtService({ secret: CUSTOMER_SECRET, signOptions: { expiresIn: '15m' } });

  function makeGuard(metadata: Record<string, unknown> = {}) {
    return new JwtAuthGuard(staffJwt, customerJwt, fakeReflector(metadata));
  }

  it('rejects an HTTP request with no token', async () => {
    const guard = makeGuard();
    await expect(guard.canActivate(httpContext())).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an HTTP request with an invalid token', async () => {
    const guard = makeGuard();
    await expect(guard.canActivate(httpContext({ authorization: 'Bearer not-a-real-token' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a valid staff token (with the type claim) and attaches a staff-shaped request.user', async () => {
    const guard = makeGuard();
    const token = await staffJwt.signAsync({ sub: 1, email: 'x@example.com', role: 'admin', type: 'staff' });
    const ctx = httpContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx.switchToHttp().getRequest().user).toEqual({ kind: 'staff', sub: 1, email: 'x@example.com', role: 'admin' });
  });

  it('lets a @Public() HTTP route through with no token', async () => {
    const guard = makeGuard({ isPublic: true });
    await expect(guard.canActivate(httpContext())).resolves.toBe(true);
  });

  it('bypasses entirely for a non-HTTP (ws) context — HTTP routes stay protected, WS is untouched', async () => {
    const guard = makeGuard();
    await expect(guard.canActivate(wsContext())).resolves.toBe(true);
  });

  describe('token separation (PROJECT.md Section 7)', () => {
    it('rejects a customer token on a staff route (no @CustomerOnly)', async () => {
      const guard = makeGuard(); // no CUSTOMER_ONLY_KEY -> staff route
      const customerToken = await customerJwt.signAsync({ sub: 1, customerId: 1, type: 'customer' });
      await expect(guard.canActivate(httpContext({ authorization: `Bearer ${customerToken}` }))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a staff token on a @CustomerOnly route', async () => {
      const guard = makeGuard({ [CUSTOMER_ONLY_KEY]: true });
      const staffToken = await staffJwt.signAsync({ sub: 1, email: 'x@example.com', role: 'admin', type: 'staff' });
      await expect(guard.canActivate(httpContext({ authorization: `Bearer ${staffToken}` }))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token signed with the wrong secret entirely, on either route type', async () => {
      const wrongSecretJwt = new JwtService({ secret: 'some-other-secret' });
      const rogueToken = await wrongSecretJwt.signAsync({ sub: 1, email: 'x@example.com', role: 'admin', type: 'staff' });

      const staffRouteGuard = makeGuard();
      const ctx = httpContext({ authorization: `Bearer ${rogueToken}` });
      await expect(staffRouteGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);

      const customerRouteGuard = makeGuard({ [CUSTOMER_ONLY_KEY]: true });
      await expect(customerRouteGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('accepts a valid customer token on a @CustomerOnly route and attaches a customer-shaped request.user', async () => {
      const guard = makeGuard({ [CUSTOMER_ONLY_KEY]: true });
      const token = await customerJwt.signAsync({ sub: 5, customerId: 9, type: 'customer' });
      const ctx = httpContext({ authorization: `Bearer ${token}` });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(ctx.switchToHttp().getRequest().user).toEqual({ kind: 'customer', sub: 5, customerId: 9 });
    });
  });
});
