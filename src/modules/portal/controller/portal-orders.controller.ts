import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { AnyAuthenticated } from '../../../common/decorators/any-authenticated.decorator.js';
import { CustomerOnly } from '../../../common/decorators/customer-only.decorator.js';
import { CurrentCustomer, type CustomerPrincipal } from '../../../common/decorators/current-customer.decorator.js';
import { PortalOrdersService } from '../service/portal-orders.service.js';
import { CreatePortalOrderDto } from '../dto/create-portal-order.dto.js';
import { ListPortalOrdersQueryDto } from '../dto/list-portal-orders.query.dto.js';

@Controller('portal/orders')
@CustomerOnly()
@AnyAuthenticated()
export class PortalOrdersController {
  constructor(private readonly portalOrdersService: PortalOrdersService) {}

  @Post()
  create(@CurrentCustomer() customer: CustomerPrincipal, @Body() dto: CreatePortalOrderDto) {
    return this.portalOrdersService.create(customer.customerId, customer.sub, dto);
  }

  @Get()
  findAll(@CurrentCustomer() customer: CustomerPrincipal, @Query() query: ListPortalOrdersQueryDto) {
    return this.portalOrdersService.findAll(customer.customerId, query);
  }

  @Get(':id')
  findOne(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', ParseIntPipe) id: number) {
    return this.portalOrdersService.findOne(customer.customerId, id);
  }

  @Patch(':id/cancel')
  cancel(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', ParseIntPipe) id: number) {
    return this.portalOrdersService.cancel(customer.customerId, id);
  }
}
