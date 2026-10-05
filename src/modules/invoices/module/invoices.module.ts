import { Module } from '@nestjs/common';
import { InvoicesController } from '../controller/invoices.controller.js';
import { InvoicesService } from '../service/invoices.service.js';
import { InvoiceEventsListener } from '../service/invoice-events.listener.js';

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceEventsListener],
  exports: [InvoicesService],
})
export class InvoicesModule {}
