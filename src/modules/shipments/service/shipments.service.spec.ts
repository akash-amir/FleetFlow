import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { AuthUser } from '../../../common/decorators/current-user.decorator.js';
import type { StorageService } from '../../../common/storage/storage.service.js';
import { ShipmentsService } from './shipments.service.js';

function matches(entity: any, where: any = {}) {
  return Object.entries(where).every(([key, value]) => entity[key] === value);
}

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const NOT_AN_IMAGE_BYTES = Buffer.from('this is definitely not an image');

function fakeFile(buffer: Buffer): Express.Multer.File {
  return { buffer } as Express.Multer.File;
}

/** Fake StorageService (per the task's "with a fake StorageService" instruction) — no real Cloudinary calls. */
function createFakeStorage() {
  const uploads: Array<{ buffer: Buffer; options: { folder: string; mimeType: string } }> = [];
  const deletedPublicIds: string[] = [];
  let counter = 0;
  let nextUploadShouldFail = false;

  const storage: StorageService & { uploads: typeof uploads; deletedPublicIds: string[]; failNextUpload(): void } = {
    uploads,
    deletedPublicIds,
    failNextUpload() {
      nextUploadShouldFail = true;
    },
    async upload(buffer, options) {
      if (nextUploadShouldFail) {
        nextUploadShouldFail = false;
        throw new Error('simulated Cloudinary failure');
      }
      const publicId = `fake-public-id-${++counter}`;
      uploads.push({ buffer, options });
      return { url: `https://fake.cdn.test/${publicId}`, publicId };
    },
    async delete(publicId) {
      deletedPublicIds.push(publicId);
    },
  };
  return storage;
}

/** In-memory stand-in for PrismaService's order/shipment/shipmentStatusHistory/user/proofOfDelivery delegates. */
function createFakePrisma() {
  const orders = new Map<number, any>();
  const shipments = new Map<number, any>();
  const users = new Map<number, any>();
  const pods = new Map<number, any>(); // keyed by shipmentId
  const history: any[] = [];
  let nextOrderId = 1;
  let nextShipmentId = 1;
  let nextHistoryId = 1;
  let nextUserId = 1;
  let nextPodId = 1;
  let podCreateShouldFail = false;

  const fake: any = {
    order: {
      findUnique: async ({ where, include }: any) => {
        const order = orders.get(where.id);
        if (!order) return null;
        if (include?.shipment) {
          const shipment = [...shipments.values()].find((s) => s.orderId === order.id) ?? null;
          return { ...order, shipment };
        }
        return order;
      },
      update: async ({ where, data }: any) => {
        const order = orders.get(where.id);
        Object.assign(order, data);
        return order;
      },
    },
    shipment: {
      create: async ({ data }: any) => {
        const shipment = {
          id: nextShipmentId++,
          status: 'ready_for_dispatch',
          driverId: null,
          pickedUpAt: null,
          deliveredAt: null,
          createdAt: new Date(),
          ...data,
        };
        shipments.set(shipment.id, shipment);
        return shipment;
      },
      findUnique: async ({ where, include }: any) => {
        const shipment = shipments.get(where.id);
        if (!shipment) return null;
        if (!include) return shipment;
        return {
          ...shipment,
          ...(include.order ? { order: orders.get(shipment.orderId) ?? null } : {}),
          ...(include.driver ? { driver: shipment.driverId ? users.get(shipment.driverId) : null } : {}),
          ...(include.statusHistory ? { statusHistory: history.filter((h) => h.shipmentId === shipment.id) } : {}),
          ...(include.proofOfDelivery ? { proofOfDelivery: pods.get(shipment.id) ?? null } : {}),
        };
      },
      findMany: async ({ where, skip = 0, take = Infinity }: any) =>
        [...shipments.values()]
          .filter((s) => matches(s, where))
          .slice(skip, skip + take)
          .map((s) => ({ ...s, order: orders.get(s.orderId) ?? null, driver: s.driverId ? users.get(s.driverId) : null })),
      count: async ({ where }: any) => [...shipments.values()].filter((s) => matches(s, where)).length,
      update: async ({ where, data }: any) => {
        const shipment = shipments.get(where.id);
        Object.assign(shipment, data);
        return shipment;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const shipment of shipments.values()) {
          if (matches(shipment, where)) {
            Object.assign(shipment, data);
            count++;
          }
        }
        return { count };
      },
    },
    shipmentStatusHistory: {
      create: async ({ data }: any) => {
        const row = { id: nextHistoryId++, createdAt: new Date(), ...data };
        history.push(row);
        return row;
      },
    },
    proofOfDelivery: {
      findUnique: async ({ where }: any) => pods.get(where.shipmentId) ?? null,
      create: async ({ data, select }: any) => {
        if (podCreateShouldFail) {
          podCreateShouldFail = false;
          throw new Error('simulated DB failure');
        }
        const pod = { id: nextPodId++, uploadedAt: new Date(), ...data };
        pods.set(pod.shipmentId, pod);
        if (!select) return pod;
        const picked: any = {};
        for (const key of Object.keys(select)) picked[key] = pod[key];
        return picked;
      },
    },
    user: {
      findUnique: async ({ where }: any) => users.get(where.id) ?? null,
    },
    $transaction: async (fn: any) => fn(fake),
    async addOrder(overrides: any = {}) {
      const order = {
        id: nextOrderId++,
        status: 'pending',
        customerId: 1,
        pickupAddress: 'A',
        deliveryAddress: 'B',
        deliveryFee: 100,
        createdAt: new Date(),
        ...overrides,
      };
      orders.set(order.id, order);
      return order;
    },
    async addDriver(overrides: any = {}) {
      const user = { id: nextUserId++, fullName: 'Driver', role: 'driver', isActive: true, ...overrides };
      users.set(user.id, user);
      return user;
    },
    failNextPodCreate() {
      podCreateShouldFail = true;
    },
  };
  return fake;
}

function actor(overrides: Partial<AuthUser>): AuthUser {
  return { sub: 1, email: 'x@example.com', role: 'admin', ...overrides };
}

describe('ShipmentsService', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let events: EventEmitter2;
  let storage: ReturnType<typeof createFakeStorage>;
  let service: ShipmentsService;

  /** Gets a shipment to in_transit, owned by a fresh driver. Returns { shipment, driver }. */
  async function shipmentInTransit() {
    const order = await prisma.addOrder();
    const shipment = await service.create({ orderId: order.id }, 999);
    const driver = await prisma.addDriver();
    await service.assignDriver(shipment.id, { driverId: driver.id }, 1);
    await service.updateStatus(shipment.id, 'picked_up', actor({ sub: driver.id, role: 'driver' }));
    await service.updateStatus(shipment.id, 'in_transit', actor({ sub: driver.id, role: 'driver' }));
    return { shipment, driver };
  }

  beforeEach(() => {
    prisma = createFakePrisma();
    storage = createFakeStorage();
    events = new EventEmitter2();
    service = new ShipmentsService(prisma as unknown as PrismaService, events, storage);
  });

  it('creates a shipment and sets the order to processing', async () => {
    const order = await prisma.addOrder();
    const shipment = await service.create({ orderId: order.id }, 999);
    expect(shipment.status).toBe('ready_for_dispatch');
    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder.status).toBe('processing');
  });

  it('rejects a second shipment for the same order with 409', async () => {
    const order = await prisma.addOrder();
    await service.create({ orderId: order.id }, 999);
    await expect(service.create({ orderId: order.id }, 999)).rejects.toThrow(ConflictException);
  });

  it('rejects creating a shipment while the order has no delivery fee set (409)', async () => {
    const order = await prisma.addOrder({ deliveryFee: null });
    await expect(service.create({ orderId: order.id }, 999)).rejects.toThrow(ConflictException);
  });

  it('rejects assigning a driver once the shipment has moved past ready_for_dispatch', async () => {
    const order = await prisma.addOrder();
    const shipment = await service.create({ orderId: order.id }, 999);
    const driver = await prisma.addDriver();
    await service.assignDriver(shipment.id, { driverId: driver.id }, 1);
    await service.updateStatus(shipment.id, 'picked_up', actor({ sub: driver.id, role: 'driver' }));

    await expect(service.assignDriver(shipment.id, { driverId: driver.id }, 1)).rejects.toThrow(ConflictException);
  });

  it('rejects a driver updating another driver\'s shipment with 403', async () => {
    const order = await prisma.addOrder();
    const shipment = await service.create({ orderId: order.id }, 999);
    const driverA = await prisma.addDriver({ fullName: 'Driver A' });
    const driverB = await prisma.addDriver({ fullName: 'Driver B' });
    await service.assignDriver(shipment.id, { driverId: driverA.id }, 1);

    await expect(
      service.updateStatus(shipment.id, 'picked_up', actor({ sub: driverB.id, role: 'driver' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a driver trying to cancel (409, not a permission a driver has)', async () => {
    const order = await prisma.addOrder();
    const shipment = await service.create({ orderId: order.id }, 999);
    const driver = await prisma.addDriver();
    await service.assignDriver(shipment.id, { driverId: driver.id }, 1);

    await expect(
      service.updateStatus(shipment.id, 'cancelled', actor({ sub: driver.id, role: 'driver' })),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects a dispatcher trying to mark a shipment delivered', async () => {
    const order = await prisma.addOrder();
    const shipment = await service.create({ orderId: order.id }, 999);
    const driver = await prisma.addDriver();
    await service.assignDriver(shipment.id, { driverId: driver.id }, 1);
    await service.updateStatus(shipment.id, 'picked_up', actor({ sub: driver.id, role: 'driver' }));
    await service.updateStatus(shipment.id, 'in_transit', actor({ sub: driver.id, role: 'driver' }));

    await expect(
      service.updateStatus(shipment.id, 'delivered', actor({ sub: 1, role: 'dispatcher' })),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects an invalid transition outright (e.g. ready_for_dispatch -> delivered)', async () => {
    const order = await prisma.addOrder();
    const shipment = await service.create({ orderId: order.id }, 999);
    const driver = await prisma.addDriver();
    await service.assignDriver(shipment.id, { driverId: driver.id }, 1);

    await expect(
      service.updateStatus(shipment.id, 'delivered', actor({ sub: driver.id, role: 'driver' })),
    ).rejects.toThrow(ConflictException);
  });

  it('cancelling a shipment also cancels its order', async () => {
    const order = await prisma.addOrder();
    const shipment = await service.create({ orderId: order.id }, 999);

    await service.updateStatus(shipment.id, 'cancelled', actor({ sub: 1, role: 'admin' }));

    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder.status).toBe('cancelled');
  });

  it('a driver\'s shipment list contains only their own shipments', async () => {
    const driverA = await prisma.addDriver({ fullName: 'Driver A' });
    const driverB = await prisma.addDriver({ fullName: 'Driver B' });
    const orderA = await prisma.addOrder();
    const orderB = await prisma.addOrder();
    const shipmentA = await service.create({ orderId: orderA.id }, 999);
    const shipmentB = await service.create({ orderId: orderB.id }, 999);
    await service.assignDriver(shipmentA.id, { driverId: driverA.id }, 1);
    await service.assignDriver(shipmentB.id, { driverId: driverB.id }, 1);

    const result = await service.findAll({ page: 1, limit: 20 }, actor({ sub: driverA.id, role: 'driver' }));

    expect(result.data).toHaveLength(1);
    expect((result.data[0] as any).id).toBe(shipmentA.id);
  });

  it('emits shipment.status.changed exactly once per successful change, and not on a rejected one', async () => {
    const order = await prisma.addOrder();
    const shipment = await service.create({ orderId: order.id }, 999);
    const driver = await prisma.addDriver();
    await service.assignDriver(shipment.id, { driverId: driver.id }, 1);

    let emitCount = 0;
    events.on('shipment.status.changed', () => emitCount++);

    await service.updateStatus(shipment.id, 'picked_up', actor({ sub: driver.id, role: 'driver' }));
    expect(emitCount).toBe(1);

    // Dispatcher can't mark delivered — this should be rejected, not emit.
    await expect(
      service.updateStatus(shipment.id, 'delivered', actor({ sub: 1, role: 'dispatcher' })),
    ).rejects.toThrow(ConflictException);
    expect(emitCount).toBe(1);
  });

  describe('proof of delivery upload', () => {
    it('lets a driver upload POD on their own in_transit shipment', async () => {
      const { shipment, driver } = await shipmentInTransit();

      const pod = await service.uploadProofOfDelivery(
        shipment.id,
        { photo: fakeFile(JPEG_BYTES), notes: 'left at front door' },
        actor({ sub: driver.id, role: 'driver' }),
      );

      expect(pod.photoUrl).toMatch(/^https:\/\/fake\.cdn\.test\//);
      expect(pod.notes).toBe('left at front door');
      expect((pod as any).photoPublicId).toBeUndefined(); // select excludes it — never exposed
      expect(storage.uploads).toHaveLength(1);
    });

    it('rejects a different driver with 403', async () => {
      const { shipment } = await shipmentInTransit();
      const otherDriver = await prisma.addDriver({ fullName: 'Someone Else' });

      await expect(
        service.uploadProofOfDelivery(shipment.id, { photo: fakeFile(JPEG_BYTES) }, actor({ sub: otherDriver.id, role: 'driver' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects upload when the shipment is not in_transit', async () => {
      const order = await prisma.addOrder();
      const shipment = await service.create({ orderId: order.id }, 999);
      const driver = await prisma.addDriver();
      await service.assignDriver(shipment.id, { driverId: driver.id }, 1);
      // Still ready_for_dispatch — never picked up.

      await expect(
        service.uploadProofOfDelivery(shipment.id, { photo: fakeFile(JPEG_BYTES) }, actor({ sub: driver.id, role: 'driver' })),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a second POD upload for the same shipment', async () => {
      const { shipment, driver } = await shipmentInTransit();
      const driverActor = actor({ sub: driver.id, role: 'driver' });
      await service.uploadProofOfDelivery(shipment.id, { photo: fakeFile(JPEG_BYTES) }, driverActor);

      await expect(
        service.uploadProofOfDelivery(shipment.id, { photo: fakeFile(JPEG_BYTES) }, driverActor),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a file whose magic bytes don\'t match any allowed image type (spoofed mimetype)', async () => {
      const { shipment, driver } = await shipmentInTransit();

      // The multer-level fileFilter already checked file.mimetype and would
      // pass a client claiming "image/jpeg" — this is the check that
      // catches it actually NOT being one, regardless of that claim.
      await expect(
        service.uploadProofOfDelivery(shipment.id, { photo: fakeFile(NOT_AN_IMAGE_BYTES) }, actor({ sub: driver.id, role: 'driver' })),
      ).rejects.toThrow(BadRequestException);
      expect(storage.uploads).toHaveLength(0); // rejected before ever touching storage
    });

    it('deletes the uploaded file(s) from storage when the DB write fails', async () => {
      const { shipment, driver } = await shipmentInTransit();
      prisma.failNextPodCreate();

      await expect(
        service.uploadProofOfDelivery(
          shipment.id,
          { photo: fakeFile(JPEG_BYTES), signature: fakeFile(JPEG_BYTES) },
          actor({ sub: driver.id, role: 'driver' }),
        ),
      ).rejects.toThrow('simulated DB failure');

      expect(storage.uploads).toHaveLength(2); // both uploads succeeded before the DB write failed
      expect(storage.deletedPublicIds).toHaveLength(2); // both cleaned up
    });

    it('rejects marking delivered when no proof of delivery exists', async () => {
      const { shipment, driver } = await shipmentInTransit();

      await expect(
        service.updateStatus(shipment.id, 'delivered', actor({ sub: driver.id, role: 'driver' })),
      ).rejects.toThrow(/proof of delivery is required/i);
    });

    it('allows marking delivered once proof of delivery exists', async () => {
      const { shipment, driver } = await shipmentInTransit();
      const driverActor = actor({ sub: driver.id, role: 'driver' });
      await service.uploadProofOfDelivery(shipment.id, { photo: fakeFile(JPEG_BYTES) }, driverActor);

      const delivered = await service.updateStatus(shipment.id, 'delivered', driverActor);

      expect(delivered.status).toBe('delivered');
      expect((delivered as any).proofOfDelivery.photoUrl).toMatch(/^https:\/\/fake\.cdn\.test\//);
    });
  });
});
