import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { AnyAuthenticated } from '../../../common/decorators/any-authenticated.decorator.js';
import { CustomerOnly } from '../../../common/decorators/customer-only.decorator.js';
import { CurrentCustomer, type CustomerPrincipal } from '../../../common/decorators/current-customer.decorator.js';
import { PortalShipmentsService } from '../service/portal-shipments.service.js';
import { ListPortalShipmentsQueryDto } from '../dto/list-portal-shipments.query.dto.js';

@Controller('portal/shipments')
@CustomerOnly()
@AnyAuthenticated()
export class PortalShipmentsController {
  constructor(private readonly portalShipmentsService: PortalShipmentsService) {}

  @Get()
  findAll(@CurrentCustomer() customer: CustomerPrincipal, @Query() query: ListPortalShipmentsQueryDto) {
    return this.portalShipmentsService.findAll(customer.customerId, query);
  }

  @Get(':id')
  findOne(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', ParseIntPipe) id: number) {
    return this.portalShipmentsService.findOne(customer.customerId, id);
  }
}
