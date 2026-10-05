import { BadRequestException, Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { Public } from '../../../common/decorators/public.decorator.js';
import { StripeWebhookService } from '../service/stripe-webhook.service.js';

@Controller('payments')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private readonly webhookService: StripeWebhookService) {}

  // @Public(): Stripe calls this directly, with no FleetFlow access token at
  // all — the signature check below (against STRIPE_WEBHOOK_SECRET) is the
  // entire authentication for this route, not JwtAuthGuard.
  @Public()
  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string) {
    // Stripe signs the EXACT raw bytes it sent — re-serializing req.body
    // back to JSON would almost certainly produce a byte-for-byte different
    // string (key order, whitespace, number formatting) and fail
    // verification even for a genuine request. `rawBody: true` in main.ts's
    // NestFactory.create(...) is what makes req.rawBody available here
    // without disabling Nest's normal JSON body parsing for every other route.
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw request body');
    }

    let event: Stripe.Event;
    try {
      event = this.webhookService.constructEvent(req.rawBody, signature);
    } catch (err) {
      this.logger.warn(`Rejected a webhook with an invalid signature: ${(err as Error).message}`);
      throw new BadRequestException('Invalid signature');
    }

    // Only a genuine processing error should produce a non-2xx past this
    // point — Stripe retries non-2xx responses, which is exactly what we
    // want for a real failure and exactly what we don't want for an event
    // we've already handled or deliberately ignored.
    await this.webhookService.handleEvent(event);
    return { received: true };
  }
}
