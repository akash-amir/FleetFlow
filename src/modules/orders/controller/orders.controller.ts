import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Permissions } from '../../../common/decorators/permissions.decorator.js';
import { OrdersService } from '../service/orders.service.js';
import { CreateOrderDto } from '../dto/create-order.dto.js';
import { UpdateOrderDto } from '../dto/update-order.dto.js';
import { ListOrdersQueryDto } from '../dto/list-orders.query.dto.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Permissions('order:create')
  create(@Body() dto: CreateOrderDto) {
    return this.ordersService.create(dto);
  }

  @Get()
  @Permissions('order:read')
  findAll(@Query() query: ListOrdersQueryDto) {
    return this.ordersService.findAll(query);
  }

  @Get(':id')
  @Permissions('order:read')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.findOne(id);
  }

  // Reuses 'order:create' rather than a separate 'order:update' permission —
  // PROJECT.md Section 6 only grants order:create/order:read to admin+dispatcher,
  // and both roles hold both anyway, so this only matters as documentation intent:
  // "can create/manage orders" vs. "can view orders".
  @Patch(':id')
  @Permissions('order:create')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderDto) {
    return this.ordersService.update(id, dto);
  }

  @Patch(':id/cancel')
  @Permissions('order:create')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.cancel(id);
  }
}
