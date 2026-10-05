import { Controller, Get } from '@nestjs/common';
import { AnyAuthenticated } from '../../../common/decorators/any-authenticated.decorator.js';
import { CustomerOnly } from '../../../common/decorators/customer-only.decorator.js';
import { CurrentCustomer, type CustomerPrincipal } from '../../../common/decorators/current-customer.decorator.js';
import { PortalDashboardService } from '../service/portal-dashboard.service.js';

@Controller('portal/dashboard')
@CustomerOnly()
@AnyAuthenticated()
export class PortalDashboardController {
  constructor(private readonly portalDashboardService: PortalDashboardService) {}

  @Get()
  getDashboard(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.portalDashboardService.getDashboard(customer.customerId);
  }
}
