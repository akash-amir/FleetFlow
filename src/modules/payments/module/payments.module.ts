import { Module } from '@nestjs/common';
import { StripeClientProvider } from '../../../common/stripe/stripe-client.provider.js';
import { CheckoutController } from '../controller/checkout.controller.js';
import { StripeWebhookController } from '../controller/stripe-webhook.controller.js';
import { CheckoutSessionService } from '../service/checkout-session.service.js';
import { StripeWebhookService } from '../service/stripe-webhook.service.js';
import { InvoicePaidListener } from '../service/invoice-paid.listener.js';

@Module({
  controllers: [CheckoutController, StripeWebhookController],
  providers: [StripeClientProvider, CheckoutSessionService, StripeWebhookService, InvoicePaidListener],
})
export class PaymentsModule {}
