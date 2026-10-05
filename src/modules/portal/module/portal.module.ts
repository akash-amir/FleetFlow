import { Module } from '@nestjs/common';
import { PortalOrdersController } from '../controller/portal-orders.controller.js';
import { PortalShipmentsController } from '../controller/portal-shipments.controller.js';
import { PortalInvoicesController } from '../controller/portal-invoices.controller.js';
import { PortalDashboardController } from '../controller/portal-dashboard.controller.js';
import { PortalOrdersService } from '../service/portal-orders.service.js';
import { PortalShipmentsService } from '../service/portal-shipments.service.js';
import { PortalInvoicesService } from '../service/portal-invoices.service.js';
import { PortalDashboardService } from '../service/portal-dashboard.service.js';

@Module({
  controllers: [PortalOrdersController, PortalShipmentsController, PortalInvoicesController, PortalDashboardController],
  providers: [PortalOrdersService, PortalShipmentsService, PortalInvoicesService, PortalDashboardService],
})
export class PortalModule {}
