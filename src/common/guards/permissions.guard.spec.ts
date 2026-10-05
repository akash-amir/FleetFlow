import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { ANY_AUTHENTICATED_KEY } from '../decorators/any-authenticated.decorator.js';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator.js';

function fakeContext(role: 'admin' | 'dispatcher' | 'driver') {
  return {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: { kind: 'staff', sub: 1, email: 'x@example.com', role } }),
    }),
  } as any;
}

function fakeCustomerContext() {
  return {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: { kind: 'customer', sub: 1, customerId: 1 } }),
    }),
  } as any;
}

// switchToHttp() throws here on purpose: if the guard ever reached into
// request-shape logic for a non-HTTP context, this test would fail loudly.
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

/** metadata: what `reflector.getAllAndOverride` should return, keyed by metadata key. */
function guardWithMetadata(metadata: Record<string, unknown>) {
  const reflector = { getAllAndOverride: (key: string) => metadata[key] } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

describe('PermissionsGuard', () => {
  // Mirrors POST /api/v1/users, which requires 'user:create' (Admin only).
  it('rejects a dispatcher with 403 on an admin-only permission', () => {
    const guard = guardWithMetadata({ [PERMISSIONS_KEY]: ['user:create'] });
    expect(() => guard.canActivate(fakeContext('dispatcher'))).toThrow(ForbiddenException);
  });

  it('allows an admin through the same check', () => {
    const guard = guardWithMetadata({ [PERMISSIONS_KEY]: ['user:create'] });
    expect(guard.canActivate(fakeContext('admin'))).toBe(true);
  });

  it('denies a route with no @Public(), @AnyAuthenticated(), or @Permissions() metadata', () => {
    const guard = guardWithMetadata({});
    expect(() => guard.canActivate(fakeContext('admin'))).toThrow(ForbiddenException);
  });

  it('allows a @Public() route through regardless of metadata gaps', () => {
    const guard = guardWithMetadata({ [IS_PUBLIC_KEY]: true });
    expect(guard.canActivate(fakeContext('driver'))).toBe(true);
  });

  it('allows any authenticated role through an @AnyAuthenticated() route', () => {
    const guard = guardWithMetadata({ [ANY_AUTHENTICATED_KEY]: true });
    expect(guard.canActivate(fakeContext('driver'))).toBe(true);
    expect(guard.canActivate(fakeContext('admin'))).toBe(true);
  });

  // Mirrors POST /api/v1/customers and POST /api/v1/orders (admin+dispatcher only).
  it.each(['customer:create', 'order:create'] as const)(
    'lets a dispatcher through %s but rejects a driver with 403',
    (permission) => {
      const guard = guardWithMetadata({ [PERMISSIONS_KEY]: [permission] });
      expect(guard.canActivate(fakeContext('dispatcher'))).toBe(true);
      expect(() => guard.canActivate(fakeContext('driver'))).toThrow(ForbiddenException);
    },
  );

  // Mirrors every /api/v1/invoices/* route (admin+dispatcher only) — driver gets 403 on all of them.
  it.each(['invoice:read', 'invoice:mark_paid', 'invoice:generate'] as const)(
    'lets a dispatcher through %s but rejects a driver with 403',
    (permission) => {
      const guard = guardWithMetadata({ [PERMISSIONS_KEY]: [permission] });
      expect(guard.canActivate(fakeContext('dispatcher'))).toBe(true);
      expect(() => guard.canActivate(fakeContext('driver'))).toThrow(ForbiddenException);
    },
  );

  it('bypasses entirely for a non-HTTP (ws) context, even with no permission metadata declared', () => {
    const guard = guardWithMetadata({});
    expect(guard.canActivate(wsContext())).toBe(true);
  });

  it('never lets a customer principal pass a @Permissions() check, even one no staff role would grant', () => {
    const guard = guardWithMetadata({ [PERMISSIONS_KEY]: ['customer:create'] });
    expect(() => guard.canActivate(fakeCustomerContext())).toThrow(ForbiddenException);
  });
});
