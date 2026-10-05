import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { CUSTOMER_ONLY_KEY } from '../decorators/customer-only.decorator.js';
import { CUSTOMER_JWT_SERVICE } from '../jwt/customer-jwt.provider.js';

interface StaffTokenPayload {
  sub: number;
  email: string;
  role: string;
  type: 'staff';
}

interface CustomerTokenPayload {
  sub: number;
  customerId: number;
  type: 'customer';
}

/**
 * Global guard (wired via APP_GUARD) — every route requires a valid access
 * token unless marked @Public(). Verifies the JWT itself directly rather than
 * pulling in @nestjs/passport + passport-jwt for a single check.
 *
 * Token separation (PROJECT.md Section 7): staff and customer tokens are
 * signed with DIFFERENT secrets and carry a `type` claim. A route is either
 * a staff route (the default) or @CustomerOnly() — never both — and this
 * guard picks exactly one secret to verify against based on that, then
 * double-checks the `type` claim matches. The secret alone already makes
 * cross-verification fail (wrong signing key -> invalid signature), and the
 * `type` check is explicit defense in depth on top of that, not instead of it.
 *
 * Written for HTTP only: `context.switchToHttp().getRequest()` doesn't mean
 * anything for a WebSocket context, so this bails out immediately for any
 * non-HTTP context. The realtime gateway authenticates sockets itself, at
 * the handshake — see RealtimeGateway.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly staffJwt: JwtService,
    @Inject(CUSTOMER_JWT_SERVICE) private readonly customerJwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
    if (!token) throw new UnauthorizedException('Missing access token');

    const isCustomerOnly = this.reflector.getAllAndOverride<boolean>(CUSTOMER_ONLY_KEY, targets);

    if (isCustomerOnly) {
      const payload = await this.verify<CustomerTokenPayload>(this.customerJwt, token);
      if (payload.type !== 'customer') throw new UnauthorizedException('This route requires a customer token');
      request.user = { kind: 'customer', sub: payload.sub, customerId: payload.customerId };
      return true;
    }

    const payload = await this.verify<StaffTokenPayload>(this.staffJwt, token);
    if (payload.type !== 'staff') throw new UnauthorizedException('This route requires a staff token');
    request.user = { kind: 'staff', sub: payload.sub, email: payload.email, role: payload.role };
    return true;
  }

  private async verify<T extends object>(jwt: JwtService, token: string): Promise<T> {
    try {
      return await jwt.verifyAsync<T>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
