import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { InvoiceStatus, Role } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CUSTOMER_JWT_SERVICE } from '../../../common/jwt/customer-jwt.provider.js';

export const OPS_ROOM = 'ops';
export function driverRoom(driverId: number): string {
  return `driver:${driverId}`;
}
export function customerRoom(customerId: number): string {
  return `customer:${customerId}`;
}

/** Pure: how long (ms, never negative) until a token with this `exp` claim expires. Extracted so the scheduling math is testable without a real socket or real wall-clock waiting. */
export function msUntilExpiry(expiresAtSeconds: number, now: number = Date.now()): number {
  return Math.max(expiresAtSeconds * 1000 - now, 0);
}

export type AuthenticatedSocketIdentity =
  | { kind: 'staff'; userId: number; role: Role; rooms: string[]; expiresAt: number }
  | { kind: 'customer'; customerId: number; rooms: string[]; expiresAt: number };

interface StaffDecodedToken {
  sub: number;
  email: string;
  role: Role;
  /** Not present on today's staff tokens — see the check below. */
  type?: string;
  exp: number;
}

interface CustomerDecodedToken {
  sub: number;
  customerId: number;
  type?: string;
  exp: number;
}

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(
    private readonly staffJwt: JwtService,
    @Inject(CUSTOMER_JWT_SERVICE) private readonly customerJwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Verifies a socket's handshake token the same way HTTP does (JwtAuthGuard),
   * except a socket connection has no route to carry a @CustomerOnly()
   * decorator telling us which secret to use upfront — so we try staff first,
   * then customer. A token is only ever valid under the secret it was
   * actually signed with, so trying both real secrets in sequence is no
   * weaker than picking the right one in advance; it only changes which
   * branch notices the signature is wrong. Returns null on any failure — the
   * caller disconnects before ever joining a room, never partially.
   */
  async authenticateSocket(token: string | undefined): Promise<AuthenticatedSocketIdentity | null> {
    if (!token) return null;

    const staff = await this.tryAuthenticateStaff(token);
    if (staff) return staff;

    return this.tryAuthenticateCustomer(token);
  }

  private async tryAuthenticateStaff(token: string): Promise<AuthenticatedSocketIdentity | null> {
    let payload: StaffDecodedToken;
    try {
      payload = await this.staffJwt.verifyAsync(token);
    } catch {
      return null;
    }
    if (payload.type === 'customer') return null;

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) return null;

    return {
      kind: 'staff',
      userId: user.id,
      role: user.role,
      rooms: this.getRoomsForRole(user.role, user.id),
      expiresAt: payload.exp,
    };
  }

  private async tryAuthenticateCustomer(token: string): Promise<AuthenticatedSocketIdentity | null> {
    let payload: CustomerDecodedToken;
    try {
      payload = await this.customerJwt.verifyAsync(token);
    } catch {
      return null;
    }
    if (payload.type !== 'customer') return null;

    const user = await this.prisma.customerUser.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) return null;

    return {
      kind: 'customer',
      customerId: user.customerId,
      rooms: [customerRoom(user.customerId)],
      expiresAt: payload.exp,
    };
  }

  /** Rooms are decided from verified identity only — never from anything a client asks for. */
  getRoomsForRole(role: Role, userId: number): string[] {
    return role === 'driver' ? [driverRoom(userId)] : [OPS_ROOM];
  }

  /**
   * The 'invoice.paid' domain event only carries an invoiceId (see
   * InvoicePaidEvent) — this is what RealtimeGateway calls to find out what
   * actually changed and who should hear about it, via the invoice's
   * current (already-updated) status and its owning customer.
   */
  async getInvoiceRoomContext(invoiceId: number): Promise<{ status: InvoiceStatus; customerId: number } | null> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true, shipment: { select: { order: { select: { customerId: true } } } } },
    });
    if (!invoice) return null;
    return { status: invoice.status, customerId: invoice.shipment.order.customerId };
  }
}
