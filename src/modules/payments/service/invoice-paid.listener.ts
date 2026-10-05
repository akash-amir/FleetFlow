import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { InvoicePaidEvent } from '../../realtime/dto/realtime-events.dto.js';

/**
 * Stub for now — this is where a "your invoice was paid" email would be
 * sent. No real email this round; the point of this listener existing at
 * all is to prove the webhook handler defers slow work instead of doing it
 * inline (see StripeWebhookService).
 */
@Injectable()
export class InvoicePaidListener {
  private readonly logger = new Logger(InvoicePaidListener.name);

  @OnEvent('invoice.paid')
  handleInvoicePaid(event: InvoicePaidEvent): void {
    this.logger.log(`Invoice ${event.invoiceId} paid — email notification not yet implemented`);
  }
}
