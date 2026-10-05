import { Controller, Param, ParseIntPipe, Post } from '@nestjs/common';
import { AnyAuthenticated } from '../../../common/decorators/any-authenticated.decorator.js';
import { CustomerOnly } from '../../../common/decorators/customer-only.decorator.js';
import { CurrentCustomer, type CustomerPrincipal } from '../../../common/decorators/current-customer.decorator.js';
import { CheckoutSessionService } from '../service/checkout-session.service.js';

// Lives in modules/payments (not modules/portal) even though the route is
// under the portal namespace — Stripe-specific concerns (the SDK client,
// session creation, webhook handling) stay together in one module.
@Controller('portal/invoices')
@CustomerOnly()
@AnyAuthenticated()
export class CheckoutController {
  constructor(private readonly checkoutSessionService: CheckoutSessionService) {}

  @Post(':id/checkout-session')
  createCheckoutSession(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', ParseIntPipe) id: number) {
    return this.checkoutSessionService.createCheckoutSession(customer.customerId, id);
  }
}
