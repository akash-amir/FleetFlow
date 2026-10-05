import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { PaginatedResult } from '../../../common/pagination.js';
import { isUniqueConstraintError } from '../../../common/prisma-errors.js';
import type { AuthUser } from '../../../common/decorators/current-user.decorator.js';
import { STORAGE_SERVICE, type StorageService, type UploadResult } from '../../../common/storage/storage.service.js';
import { sniffImageMimeType } from '../../../common/storage/image-validation.js';
import { canActorTransition } from './shipment-state-machine.js';
import { CreateShipmentDto } from '../dto/create-shipment.dto.js';
import { AssignDriverDto } from '../dto/assign-driver.dto.js';
import { ListShipmentsQueryDto } from '../dto/list-shipments.query.dto.js';

/** Internal signal only: thrown to roll back a losing status-update race (see updateStatus() below). */
class ShipmentStatusConflictError extends Error {}
/** Internal signal only: thrown inside the same transaction as the status update (see updateStatus() below). */
class DeliveryRequiresProofError extends Error {}

const ORDER_SUMMARY_SELECT = { id: true, pickupAddress: true, deliveryAddress: true, status: true, customerId: true } as const;
const DRIVER_NAME_SELECT = { id: true, fullName: true } as const;
const POD_SELECT = { photoUrl: true, signatureUrl: true, notes: true, uploadedAt: true } as const; // never publicIds
const POD_FOLDER = 'fleetflow/pod';

export interface UploadPodInput {
  photo: Express.Multer.File;
  signature?: Express.Multer.File;
  notes?: string;
}

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async create(dto: CreateShipmentDto, actorId: number) {
    const order = await this.prisma.order.findUnique({ where: { id: dto.orderId }, include: { shipment: true } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'pending') {
      throw new ConflictException(`Order must be pending to create a shipment (current status: ${order.status})`);
    }
    if (order.shipment) throw new ConflictException('This order already has a shipment');
    if (order.deliveryFee === null) throw new ConflictException('Order has no delivery fee set');

    try {
      const shipment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.shipment.create({ data: { orderId: order.id } });
        await tx.order.update({ where: { id: order.id }, data: { status: 'processing' } });
        await tx.shipmentStatusHistory.create({
          data: { shipmentId: created.id, fromStatus: null, toStatus: created.status, changedById: actorId },
        });
        return created;
      });
      return shipment;
    } catch (err) {
      // Defense in depth: Shipment.orderId is @unique, so a second concurrent
      // create for the same order fails here even if both requests passed
      // the upfront check above.
      if (isUniqueConstraintError(err)) throw new ConflictException('This order already has a shipment');
      throw err;
    }
  }

  async assignDriver(id: number, dto: AssignDriverDto, assignedById: number) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id } });
    if (!shipment) throw new NotFoundException('Shipment not found');
    if (shipment.status !== 'ready_for_dispatch') {
      throw new ConflictException(`Driver can only be assigned while ready_for_dispatch (current status: ${shipment.status})`);
    }

    const driver = await this.prisma.user.findUnique({ where: { id: dto.driverId } });
    if (!driver || driver.role !== 'driver' || !driver.isActive) {
      throw new BadRequestException('driverId must reference an active user with role driver');
    }

    const updated = await this.prisma.shipment.update({ where: { id }, data: { driverId: dto.driverId } });

    // Emitted only after the update above has committed — the realtime
    // gateway pushes 'shipment:assigned' to 'ops' and to the assigned
    // driver's own room from this.
    this.eventEmitter.emit('shipment.driver.assigned', {
      shipmentId: id,
      driverId: dto.driverId,
      assignedById,
    });

    return updated;
  }

  /**
   * `driver -> updateStatus` needs BOTH the driver's blanket permission
   * (shipment:update_status_own) and a per-resource ownership check;
   * `admin/dispatcher -> updateStatus` uses a different permission
   * (shipment:create) for the same route. @Permissions() can only express
   * "must have ALL of these", not "either this OR that depending on role",
   * so this route is @AnyAuthenticated() at the controller and every real
   * authorization decision — ownership AND which transitions a role may
   * trigger — happens here, which is also where PROJECT.md's "role alone
   * is not enough" principle already put the ownership check.
   */
  async updateStatus(id: number, toStatus: ShipmentStatus, actor: AuthUser) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: { order: { select: { customerId: true } } },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');

    if (actor.role === 'driver' && shipment.driverId !== actor.sub) {
      throw new ForbiddenException('You can only update your own shipments');
    }

    const fromStatus = shipment.status;
    if (!canActorTransition(actor.role, fromStatus, toStatus)) {
      throw new ConflictException(`Cannot transition shipment from ${fromStatus} to ${toStatus}`);
    }

    const data: { status: ShipmentStatus; pickedUpAt?: Date; deliveredAt?: Date; driverId?: null } = { status: toStatus };
    const now = new Date();
    if (toStatus === 'picked_up') data.pickedUpAt = now;
    if (toStatus === 'delivered') data.deliveredAt = now;
    if (toStatus === 'ready_for_dispatch') data.driverId = null; // retry: must be reassigned

    try {
      await this.prisma.$transaction(async (tx) => {
        if (toStatus === 'delivered') {
          const pod = await tx.proofOfDelivery.findUnique({ where: { shipmentId: id } });
          if (!pod) throw new DeliveryRequiresProofError();
        }

        // Atomic compare-and-swap: only succeeds if the shipment is still in
        // the status we just read above. If another request changed it
        // first — two dispatchers racing to cancel the same shipment, a
        // driver double-tapping "delivered" — `count` comes back 0 and we
        // abort rather than silently overwriting a status we didn't expect.
        const { count } = await tx.shipment.updateMany({ where: { id, status: fromStatus }, data });
        if (count === 0) throw new ShipmentStatusConflictError();

        if (toStatus === 'cancelled') {
          await tx.order.update({ where: { id: shipment.orderId }, data: { status: 'cancelled' } });
        }
        await tx.shipmentStatusHistory.create({
          data: { shipmentId: id, fromStatus, toStatus, changedById: actor.sub },
        });
      });
    } catch (err) {
      if (err instanceof ShipmentStatusConflictError) {
        throw new ConflictException('Shipment status changed concurrently — please retry');
      }
      if (err instanceof DeliveryRequiresProofError) {
        throw new ConflictException('Proof of delivery is required before marking delivered');
      }
      throw err;
    }

    const updated = await this.findOne(id, actor);

    // Emitted only after the transaction above has committed — never on a
    // rejected or rolled-back attempt, so a future subscriber only ever
    // sees changes that actually happened.
    this.eventEmitter.emit('shipment.status.changed', {
      shipmentId: id,
      orderId: shipment.orderId,
      customerId: shipment.order.customerId,
      fromStatus,
      toStatus,
      driverId: updated.driverId,
      changedById: actor.sub,
      changedAt: new Date(),
    });

    return updated;
  }

  async findAll(query: ListShipmentsQueryDto, actor: AuthUser): Promise<PaginatedResult<unknown>> {
    const where: Prisma.ShipmentWhereInput = {
      ...(actor.role === 'driver' ? { driverId: actor.sub } : query.driverId ? { driverId: query.driverId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        include: { order: { select: ORDER_SUMMARY_SELECT }, driver: { select: DRIVER_NAME_SELECT } },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { id: 'asc' },
      }),
      this.prisma.shipment.count({ where }),
    ]);

    return { data, meta: { page: query.page, limit: query.limit, total } };
  }

  async findOne(id: number, actor: AuthUser) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        order: { select: ORDER_SUMMARY_SELECT },
        driver: { select: DRIVER_NAME_SELECT },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        proofOfDelivery: { select: POD_SELECT },
      },
    });
    // A driver requesting a shipment outside their visibility scope gets
    // 404, not 403 — it's simply not in their view, and 404 avoids
    // confirming to them that some OTHER driver's shipment id exists.
    if (!shipment || (actor.role === 'driver' && shipment.driverId !== actor.sub)) {
      throw new NotFoundException('Shipment not found');
    }
    return shipment;
  }

  async uploadProofOfDelivery(shipmentId: number, input: UploadPodInput, actor: AuthUser) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw new NotFoundException('Shipment not found');
    if (shipment.driverId !== actor.sub) {
      throw new ForbiddenException('You can only upload proof of delivery for your own shipments');
    }
    if (shipment.status !== 'in_transit') {
      throw new ConflictException(`Proof of delivery can only be uploaded while in_transit (current status: ${shipment.status})`);
    }

    const existing = await this.prisma.proofOfDelivery.findUnique({ where: { shipmentId } });
    if (existing) throw new ConflictException('Proof of delivery already uploaded for this shipment');

    // Authoritative check — never trust the client-declared mimetype alone
    // (that's just what multer's fileFilter looked at). This looks at the
    // actual bytes.
    const photoMime = sniffImageMimeType(input.photo.buffer);
    if (!photoMime) throw new BadRequestException('photo does not look like a valid JPEG/PNG/WEBP image');
    const signatureMime = input.signature ? sniffImageMimeType(input.signature.buffer) : undefined;
    if (input.signature && !signatureMime) {
      throw new BadRequestException('signature does not look like a valid JPEG/PNG/WEBP image');
    }

    const photoUpload = await this.storage.upload(input.photo.buffer, { folder: POD_FOLDER, mimeType: photoMime });
    let signatureUpload: UploadResult | undefined;

    try {
      if (input.signature && signatureMime) {
        signatureUpload = await this.storage.upload(input.signature.buffer, { folder: POD_FOLDER, mimeType: signatureMime });
      }

      return await this.prisma.proofOfDelivery.create({
        data: {
          shipmentId,
          photoUrl: photoUpload.url,
          photoPublicId: photoUpload.publicId,
          signatureUrl: signatureUpload?.url,
          signaturePublicId: signatureUpload?.publicId,
          notes: input.notes,
        },
        select: POD_SELECT,
      });
    } catch (err) {
      // The file(s) are already sitting in Cloudinary at this point. If
      // anything after that upload fails — the signature upload, or the DB
      // write itself (constraint violation, connection drop, whatever) —
      // we'd otherwise leak orphaned files that no Postgres row ever
      // points to. Best effort only: if the delete itself fails, we still
      // want the caller to see the ORIGINAL error, not a masking one.
      await Promise.allSettled([
        this.storage.delete(photoUpload.publicId),
        ...(signatureUpload ? [this.storage.delete(signatureUpload.publicId)] : []),
      ]);
      throw err;
    }
  }
}
