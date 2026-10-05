import type { Order, Prisma, ProofOfDelivery, Shipment } from '@prisma/client';

// Decimal fields serialize to strings automatically (decimal.js's toJSON
// aliases toString()) — same convention as every other module. No
// deliveryFee here: a customer never sees the fee on the order itself, only
// later as the invoice amount.
export class PortalOrderResponseDto {
  id!: number;
  pickupAddress!: string;
  deliveryAddress!: string;
  itemDescription!: string | null;
  declaredAmount!: Prisma.Decimal | null;
  status!: string;
  createdAt!: Date;

  static fromEntity(order: Order): PortalOrderResponseDto {
    return {
      id: order.id,
      pickupAddress: order.pickupAddress,
      deliveryAddress: order.deliveryAddress,
      itemDescription: order.itemDescription,
      declaredAmount: order.declaredAmount,
      status: order.status,
      createdAt: order.createdAt,
    };
  }
}

export interface PortalOrderShipmentSummary {
  status: string;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  proofOfDelivery: { photoUrl: string | null; signatureUrl: string | null; notes: string | null } | null;
}

type OrderWithShipment = Order & {
  shipment: (Pick<Shipment, 'status' | 'pickedUpAt' | 'deliveredAt'> & {
    proofOfDelivery: Pick<ProofOfDelivery, 'photoUrl' | 'signatureUrl' | 'notes'> | null;
  }) | null;
};

export class PortalOrderDetailResponseDto extends PortalOrderResponseDto {
  shipment!: PortalOrderShipmentSummary | null;

  static fromEntityWithShipment(order: OrderWithShipment): PortalOrderDetailResponseDto {
    return {
      ...PortalOrderResponseDto.fromEntity(order),
      shipment: order.shipment
        ? {
            status: order.shipment.status,
            pickedUpAt: order.shipment.pickedUpAt,
            deliveredAt: order.shipment.deliveredAt,
            proofOfDelivery: order.shipment.proofOfDelivery
              ? {
                  photoUrl: order.shipment.proofOfDelivery.photoUrl,
                  signatureUrl: order.shipment.proofOfDelivery.signatureUrl,
                  notes: order.shipment.proofOfDelivery.notes,
                }
              : null,
          }
        : null,
    };
  }
}
