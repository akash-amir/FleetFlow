import { Module } from '@nestjs/common';
import { ShipmentsController } from '../controller/shipments.controller.js';
import { ShipmentsService } from '../service/shipments.service.js';
import { STORAGE_SERVICE } from '../../../common/storage/storage.service.js';
import { CloudinaryStorageService } from '../../../common/storage/cloudinary-storage.service.js';
import { InvoicesModule } from '../../invoices/module/invoices.module.js';

// Proof-of-delivery lives here rather than a separate `modules/pod`: it's a
// single action scoped entirely to one shipment (upload only, no list/get/
// update of its own), and it reuses ShipmentsService's existing
// driver-ownership and status-check patterns — a whole extra module would
// just split one cohesive piece of shipment lifecycle across two places.
@Module({
  imports: [InvoicesModule], // for the POST :id/invoice fallback route only
  controllers: [ShipmentsController],
  providers: [ShipmentsService, { provide: STORAGE_SERVICE, useClass: CloudinaryStorageService }],
})
export class ShipmentsModule {}
