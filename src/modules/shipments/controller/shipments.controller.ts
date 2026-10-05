import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UploadedFiles, UseFilters, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Permissions } from '../../../common/decorators/permissions.decorator.js';
import { AnyAuthenticated } from '../../../common/decorators/any-authenticated.decorator.js';
import { CurrentUser, type AuthUser } from '../../../common/decorators/current-user.decorator.js';
import { MulterExceptionFilter } from '../../../common/filters/multer-exception.filter.js';
import { imageFileFilter, MAX_IMAGE_FILE_SIZE_BYTES } from '../../../common/storage/image-validation.js';
import { InvoicesService } from '../../invoices/service/invoices.service.js';
import { ShipmentsService } from '../service/shipments.service.js';
import { CreateShipmentDto } from '../dto/create-shipment.dto.js';
import { AssignDriverDto } from '../dto/assign-driver.dto.js';
import { UpdateShipmentStatusDto } from '../dto/update-shipment-status.dto.js';
import { ListShipmentsQueryDto } from '../dto/list-shipments.query.dto.js';
import { UploadPodDto } from '../dto/upload-pod.dto.js';

type PodFiles = { photo?: Express.Multer.File[]; signature?: Express.Multer.File[] };

@Controller('shipments')
export class ShipmentsController {
  constructor(
    private readonly shipmentsService: ShipmentsService,
    private readonly invoicesService: InvoicesService,
  ) {}

  @Post()
  @Permissions('shipment:create')
  create(@Body() dto: CreateShipmentDto, @CurrentUser() actor: AuthUser) {
    return this.shipmentsService.create(dto, actor.sub);
  }

  @Patch(':id/assign-driver')
  @Permissions('shipment:assign_driver')
  assignDriver(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignDriverDto, @CurrentUser() actor: AuthUser) {
    return this.shipmentsService.assignDriver(id, dto, actor.sub);
  }

  // See the comment on ShipmentsService.updateStatus for why this is
  // @AnyAuthenticated() rather than @Permissions(...) — driver and
  // admin/dispatcher use two different permissions on this one route.
  @Patch(':id/status')
  @AnyAuthenticated()
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateShipmentStatusDto, @CurrentUser() actor: AuthUser) {
    return this.shipmentsService.updateStatus(id, dto.status, actor);
  }

  // @AnyAuthenticated(): visibility scoping (all vs. own-only) is enforced
  // in the service per PROJECT.md's instruction, not by the permission gate.
  @Get()
  @AnyAuthenticated()
  findAll(@Query() query: ListShipmentsQueryDto, @CurrentUser() actor: AuthUser) {
    return this.shipmentsService.findAll(query, actor);
  }

  @Get(':id')
  @AnyAuthenticated()
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.shipmentsService.findOne(id, actor);
  }

  @Post(':id/pod')
  @Permissions('pod:upload_own')
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'photo', maxCount: 1 },
        { name: 'signature', maxCount: 1 },
      ],
      { storage: memoryStorage(), limits: { fileSize: MAX_IMAGE_FILE_SIZE_BYTES }, fileFilter: imageFileFilter },
    ),
  )
  uploadPod(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: PodFiles,
    @Body() dto: UploadPodDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const photo = files.photo?.[0];
    if (!photo) throw new BadRequestException('photo is required');
    const signature = files.signature?.[0];
    return this.shipmentsService.uploadProofOfDelivery(id, { photo, signature, notes: dto.notes }, actor);
  }

  // Fallback for a delivered shipment the auto-generation listener missed
  // (see InvoiceEventsListener) — lives under /shipments for the resource-
  // nesting URL, but the actual invoice logic is entirely InvoicesService's.
  @Post(':id/invoice')
  @Permissions('invoice:generate')
  generateInvoice(@Param('id', ParseIntPipe) id: number) {
    return this.invoicesService.generateForShipment(id);
  }
}
