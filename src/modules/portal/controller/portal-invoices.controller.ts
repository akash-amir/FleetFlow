import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { AnyAuthenticated } from '../../../common/decorators/any-authenticated.decorator.js';
import { CustomerOnly } from '../../../common/decorators/customer-only.decorator.js';
import { CurrentCustomer, type CustomerPrincipal } from '../../../common/decorators/current-customer.decorator.js';
import { PortalInvoicesService } from '../service/portal-invoices.service.js';
import { ListPortalInvoicesQueryDto } from '../dto/list-portal-invoices.query.dto.js';

@Controller('portal/invoices')
@CustomerOnly()
@AnyAuthenticated()
export class PortalInvoicesController {
  constructor(private readonly portalInvoicesService: PortalInvoicesService) {}

  @Get()
  findAll(@CurrentCustomer() customer: CustomerPrincipal, @Query() query: ListPortalInvoicesQueryDto) {
    return this.portalInvoicesService.findAll(customer.customerId, query);
  }

  @Get(':id')
  findOne(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', ParseIntPipe) id: number) {
    return this.portalInvoicesService.findOne(customer.customerId, id);
  }
}
