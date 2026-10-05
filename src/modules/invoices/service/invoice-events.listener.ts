import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ShipmentStatus } from '@prisma/client';
import { InvoicesService } from './invoices.service.js';

interface ShipmentStatusChangedPayload {
  shipmentId: number;
  fromStatus: ShipmentStatus | null;
  toStatus: ShipmentStatus;
  driverId: number | null;
  changedById: number;
}

@Injectable()
export class InvoiceEventsListener {
  private readonly logger = new Logger(InvoiceEventsListener.name);

  constructor(private readonly invoicesService: InvoicesService) {}

  @OnEvent('shipment.status.changed')
  async handleShipmentStatusChanged(payload: ShipmentStatusChangedPayload): Promise<void> {
    if (payload.toStatus !== 'delivered') return;

    try {
      await this.invoicesService.createForDeliveredShipment(payload.shipmentId);
    } catch (err) {
      // The shipment's own status-update transaction has already committed
      // by the time this event fires — there is nothing left to roll back,
      // so this is eventual consistency, not part of that transaction. A
      // listener must never throw into the emitter (EventEmitter2 has no
      // error handling of its own, and one broken listener must not affect
      // any other listener on the same event). If invoice creation fails
      // here, POST /shipments/:id/invoice exists specifically so a human
      // can retry it later.
      this.logger.error(`Failed to auto-generate invoice for shipment ${payload.shipmentId}`, err as Error);
    }
  }
}
