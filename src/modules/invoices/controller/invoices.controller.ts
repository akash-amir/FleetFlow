import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { Permissions } from '../../../common/decorators/permissions.decorator.js';
import { CurrentUser, type AuthUser } from '../../../common/decorators/current-user.decorator.js';
import { InvoicesService } from '../service/invoices.service.js';
import { RecordPaymentDto } from '../dto/record-payment.dto.js';
import { ListInvoicesQueryDto } from '../dto/list-invoices.query.dto.js';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @Permissions('invoice:read')
  findAll(@Query() query: ListInvoicesQueryDto) {
    return this.invoicesService.findAll(query);
  }

  @Get(':id')
  @Permissions('invoice:read')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.invoicesService.findOne(id);
  }

  @Post(':id/payments')
  @Permissions('invoice:mark_paid')
  recordPayment(@Param('id', ParseIntPipe) id: number, @Body() dto: RecordPaymentDto, @CurrentUser() actor: AuthUser) {
    return this.invoicesService.recordPayment(id, dto, actor.sub);
  }
}
