import type { InvoiceStatus, ShipmentStatus } from '@prisma/client';

/** Payload of the domain event ShipmentsService emits after a status change commits. */
export interface ShipmentStatusChangedEvent {
  shipmentId: number;
  orderId: number;
  customerId: number;
  fromStatus: ShipmentStatus | null;
  toStatus: ShipmentStatus;
  driverId: number | null;
  changedById: number;
  changedAt: Date;
}

/** Payload of the domain event ShipmentsService emits after assign-driver commits. */
export interface ShipmentDriverAssignedEvent {
  shipmentId: number;
  driverId: number;
  assignedById: number;
}

/** What clients actually receive for 'shipment:updated' — ids and statuses only, no denormalized extras. */
export interface ShipmentUpdatedPayload {
  shipmentId: number;
  fromStatus: ShipmentStatus | null;
  toStatus: ShipmentStatus;
  driverId: number | null;
  changedAt: string; // ISO string — JSON has no Date type
}

/** What clients receive for 'shipment:assigned'. */
export interface ShipmentAssignedPayload {
  shipmentId: number;
  driverId: number;
  assignedById: number;
}

/** Reduced 'shipment:updated' sent to 'customer:{customerId}' only — no driver info, no actor info. */
export interface PortalShipmentUpdatedPayload {
  shipmentId: number;
  orderId: number;
  toStatus: ShipmentStatus;
  changedAt: string; // ISO string
}

/**
 * Payload of the domain event StripeWebhookService emits after a webhook-
 * driven payment commits. Deliberately minimal — just enough for a listener
 * to go look up whatever it specifically needs (e.g. RealtimeGateway reads
 * the invoice's current status and owning customerId; a future email
 * listener would only need the id).
 */
export interface InvoicePaidEvent {
  invoiceId: number;
}

/** What clients receive for 'invoice:updated'. */
export interface InvoiceUpdatedPayload {
  invoiceId: number;
  status: InvoiceStatus;
}
