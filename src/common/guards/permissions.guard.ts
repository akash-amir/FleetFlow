import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { ANY_AUTHENTICATED_KEY } from '../decorators/any-authenticated.decorator.js';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator.js';
import { ROLE_PERMISSIONS, type Permission } from '../permissions.js';
import type { AuthUser } from '../decorators/current-user.decorator.js';

/**
 * Checks role-level permissions from @Permissions(). Deny by default: a
 * route must explicitly opt into one of @Public() (no auth at all),
 * @AnyAuthenticated() (any logged-in role), or @Permissions(...) (specific
 * roles only) — forgetting the decorator on a new route fails closed, not open.
 *
 * This is only the mechanism — resource-ownership checks (e.g. a driver's
 * own shipment) are the responsibility of the service methods that use
 * this guard, per PROJECT.md Section 6's "role alone is not enough" principle.
 *
 * Written for HTTP only, same reasoning as JwtAuthGuard: `getRequest()` on a
 * non-HTTP context isn't meaningful, so this bails out immediately for any
 * non-HTTP context. Permission checks for the realtime gateway are handled
 * separately (there's nothing to check — it only pushes server-decided
 * rooms, clients never invoke a permissioned action over the socket).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ANY_AUTHENTICATED_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);
    if (!required || required.length === 0) {
      throw new ForbiddenException('This route has no permission requirements declared');
    }

    const user = context.switchToHttp().getRequest().user;
    // A customer principal never has role-based permissions — @Permissions()
    // is a staff-only mechanism. Explicit check rather than relying on
    // `ROLE_PERMISSIONS[undefined]` happening to come back empty.
    if (user.kind !== 'staff') {
      throw new ForbiddenException('This route requires staff permissions');
    }

    const granted = ROLE_PERMISSIONS[(user as AuthUser).role] ?? [];
    const allowed = required.every((permission) => granted.includes(permission));
    if (!allowed) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}
