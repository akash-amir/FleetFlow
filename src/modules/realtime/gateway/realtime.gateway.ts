import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { RealtimeService, OPS_ROOM, driverRoom, customerRoom, msUntilExpiry } from '../service/realtime.service.js';
import type {
  InvoicePaidEvent,
  InvoiceUpdatedPayload,
  PortalShipmentUpdatedPayload,
  ShipmentAssignedPayload,
  ShipmentDriverAssignedEvent,
  ShipmentStatusChangedEvent,
  ShipmentUpdatedPayload,
} from '../dto/realtime-events.dto.js';

@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3001' },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  // Per-socket "disconnect at token expiry" timers. Cleared in
  // handleDisconnect so a socket that disconnects for any other reason
  // first (network drop, tab closed) doesn't leave a dangling timer.
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly realtimeService: RealtimeService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    const identity = await this.realtimeService.authenticateSocket(token);

    // Reject BEFORE joining any room — an unauthenticated or no-longer-valid
    // socket must never sit in 'ops' or a driver room even momentarily.
    if (!identity) {
      client.disconnect(true);
      return;
    }

    client.data.kind = identity.kind;
    if (identity.kind === 'staff') {
      client.data.userId = identity.userId;
      client.data.role = identity.role;
    } else {
      client.data.customerId = identity.customerId;
    }
    for (const room of identity.rooms) {
      client.join(room);
    }

    // Sockets outlive access tokens: HTTP silently gets a new one via
    // /auth/refresh on the next request, but an open socket has no "next
    // request" to trigger that. This timer is also the only mechanism that
    // eventually cuts off a user deactivated mid-session — there's no live
    // push for that — because when it fires the client must reconnect,
    // and reconnecting re-verifies isActive from scratch on the new handshake.
    const timer = setTimeout(() => {
      client.emit('disconnect_reason', { reason: 'token_expired' });
      client.disconnect(true);
    }, msUntilExpiry(identity.expiresAt));
    this.expiryTimers.set(client.id, timer);
  }

  handleDisconnect(client: Socket): void {
    const timer = this.expiryTimers.get(client.id);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(client.id);
    }
  }

  @OnEvent('shipment.status.changed')
  handleShipmentStatusChanged(event: ShipmentStatusChangedEvent): void {
    const payload: ShipmentUpdatedPayload = {
      shipmentId: event.shipmentId,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      driverId: event.driverId,
      changedAt: event.changedAt.toISOString(),
    };
    this.emitSafely(OPS_ROOM, 'shipment:updated', payload);
    if (event.driverId != null) {
      this.emitSafely(driverRoom(event.driverId), 'shipment:updated', payload);
    }

    // Reduced payload for the customer who owns the order — no driver info,
    // no actor info, just enough to update their own view.
    const customerPayload: PortalShipmentUpdatedPayload = {
      shipmentId: event.shipmentId,
      orderId: event.orderId,
      toStatus: event.toStatus,
      changedAt: event.changedAt.toISOString(),
    };
    this.emitSafely(customerRoom(event.customerId), 'shipment:updated', customerPayload);
  }

  @OnEvent('invoice.paid')
  async handleInvoicePaid(event: InvoicePaidEvent): Promise<void> {
    const context = await this.realtimeService.getInvoiceRoomContext(event.invoiceId);
    if (!context) {
      // Shouldn't happen — the invoice existed moments ago inside the same
      // webhook transaction that emitted this event. Log and drop rather
      // than throw: there's no transaction left to roll back.
      this.logger.warn(`invoice.paid fired for invoice ${event.invoiceId}, which no longer resolves to a room`);
      return;
    }

    const payload: InvoiceUpdatedPayload = { invoiceId: event.invoiceId, status: context.status };
    this.emitSafely(OPS_ROOM, 'invoice:updated', payload);
    this.emitSafely(customerRoom(context.customerId), 'invoice:updated', payload);
  }

  @OnEvent('shipment.driver.assigned')
  handleShipmentDriverAssigned(event: ShipmentDriverAssignedEvent): void {
    const payload: ShipmentAssignedPayload = {
      shipmentId: event.shipmentId,
      driverId: event.driverId,
      assignedById: event.assignedById,
    };
    this.emitSafely(OPS_ROOM, 'shipment:assigned', payload);
    this.emitSafely(driverRoom(event.driverId), 'shipment:assigned', payload);
  }

  /** A failure here must never throw back into the emitting service — that transaction already committed. */
  private emitSafely(room: string, event: string, payload: unknown): void {
    try {
      this.server.to(room).emit(event, payload);
    } catch (err) {
      this.logger.error(`Failed to emit '${event}' to room '${room}'`, err as Error);
    }
  }
}
