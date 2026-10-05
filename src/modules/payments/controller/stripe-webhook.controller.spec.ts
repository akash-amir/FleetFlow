import { BadRequestException } from '@nestjs/common';
import { StripeWebhookController } from './stripe-webhook.controller.js';
import type { StripeWebhookService } from '../service/stripe-webhook.service.js';

function fakeRequest(rawBody?: Buffer): any {
  return { rawBody };
}

describe('StripeWebhookController', () => {
  it('rejects an invalid signature with 400 and never calls handleEvent', async () => {
    const handleEvent = vi.fn();
    const webhookService = {
      constructEvent: vi.fn(() => {
        throw new Error('No signatures found matching the expected signature for payload');
      }),
      handleEvent,
    } as unknown as StripeWebhookService;
    const controller = new StripeWebhookController(webhookService);

    await expect(controller.handleWebhook(fakeRequest(Buffer.from('{}')), 'bad-sig')).rejects.toThrow(BadRequestException);
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it('rejects a request with no raw body before ever touching Stripe', async () => {
    const constructEvent = vi.fn();
    const webhookService = { constructEvent, handleEvent: vi.fn() } as unknown as StripeWebhookService;
    const controller = new StripeWebhookController(webhookService);

    await expect(controller.handleWebhook(fakeRequest(undefined), 'sig')).rejects.toThrow(BadRequestException);
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it('processes a validly-signed event and acknowledges it', async () => {
    const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } };
    const handleEvent = vi.fn().mockResolvedValue(undefined);
    const webhookService = { constructEvent: vi.fn(() => event), handleEvent } as unknown as StripeWebhookService;
    const controller = new StripeWebhookController(webhookService);

    const result = await controller.handleWebhook(fakeRequest(Buffer.from('{}')), 'good-sig');

    expect(result).toEqual({ received: true });
    expect(handleEvent).toHaveBeenCalledWith(event);
  });
});
