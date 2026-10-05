import type { ShipmentStatus } from '@prisma/client';

export interface PortalShipmentTimelineEntry {
  status: ShipmentStatus;
  at: Date;
}

export interface PortalShipmentDriverSummary {
  firstName: string;
}

export interface PortalShipmentOrderSummary {
  id: number;
  pickupAddress: string;
  deliveryAddress: string;
  status: string;
}

export interface PortalShipmentProofOfDelivery {
  photoUrl: string | null;
  signatureUrl: string | null;
  notes: string | null;
}

// Driver is shown as first-name-only, and only while the shipment is
// actually moving (picked_up / in_transit) — never email, id, or phone,
// and not before pickup or after delivery either.
const DRIVER_VISIBLE_STATUSES: ShipmentStatus[] = ['picked_up', 'in_transit'];

function firstNameOnly(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

interface ShipmentEntity {
  id: number;
  status: ShipmentStatus;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  order: PortalShipmentOrderSummary;
  driver: { fullName: string } | null;
  proofOfDelivery: PortalShipmentProofOfDelivery | null;
  statusHistory: Array<{ toStatus: ShipmentStatus; createdAt: Date }>;
}

export class PortalShipmentResponseDto {
  id!: number;
  status!: ShipmentStatus;
  pickedUpAt!: Date | null;
  deliveredAt!: Date | null;
  order!: PortalShipmentOrderSummary;
  driver!: PortalShipmentDriverSummary | null;
  proofOfDelivery!: PortalShipmentProofOfDelivery | null;
  timeline!: PortalShipmentTimelineEntry[];

  static fromEntity(shipment: ShipmentEntity): PortalShipmentResponseDto {
    return {
      id: shipment.id,
      status: shipment.status,
      pickedUpAt: shipment.pickedUpAt,
      deliveredAt: shipment.deliveredAt,
      order: shipment.order,
      driver:
        shipment.driver && DRIVER_VISIBLE_STATUSES.includes(shipment.status)
          ? { firstName: firstNameOnly(shipment.driver.fullName) }
          : null,
      proofOfDelivery: shipment.proofOfDelivery,
      timeline: shipment.statusHistory.map((h) => ({ status: h.toStatus, at: h.createdAt })),
    };
  }
}
