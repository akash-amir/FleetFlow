import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CUSTOMER_JWT_SERVICE } from '../../common/jwt/customer-jwt.provider.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import { OrdersModule } from '../orders/module/orders.module.js';
import { PortalModule } from './module/portal.module.js';

/**
 * Full HTTP integration test: real guards (JwtAuthGuard + PermissionsGuard),
 * real portal controllers/services, real ValidationPipe, faked Prisma. This
 * is the only way to prove tenant isolation and token-type rejection hold
 * for the ACTUAL wired routes, not just the guard logic in isolation.
 */

function matches(entity: any, where: any = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = entity[key];
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return (value as any).in.includes(actual);
      if ('not' in value) return actual !== (value as any).not;
      if ('lt' in value) return actual < (value as any).lt;
      if ('gte' in value) return actual >= (value as any).gte;
    }
    return actual === value;
  });
}

function createFakePrisma() {
  const orders = new Map<number, any>();
  const shipments = new Map<number, any>();
  const statusHistories: any[] = [];
  const proofOfDeliveries = new Map<number, any>();
  const users = new Map<number, any>();
  const invoices = new Map<number, any>();
  const payments: any[] = [];
  let nextOrderId = 1;
  let nextShipmentId = 1;
  let nextInvoiceId = 1;
  let nextPaymentId = 1;
  let nextUserId = 1;

  function shipmentCustomerId(shipment: any): number {
    return orders.get(shipment.orderId)!.customerId;
  }
  function invoiceCustomerId(invoice: any): number {
    return shipmentCustomerId(shipments.get(invoice.shipmentId));
  }
  function orderMatches(order: any, where: any): boolean {
    const { id, customerId, status } = where;
    if (id !== undefined && !matches(order, { id })) return false;
    if (customerId !== undefined && order.customerId !== customerId) return false;
    if (status !== undefined && !matches(order, { status })) return false;
    return true;
  }
  function shipmentMatches(shipment: any, where: any): boolean {
    const { id, status, order, deliveredAt } = where;
    if (id !== undefined && !matches(shipment, { id })) return false;
    if (status !== undefined && !matches(shipment, { status })) return false;
    if (order?.customerId !== undefined && shipmentCustomerId(shipment) !== order.customerId) return false;
    if (deliveredAt !== undefined && !matches(shipment, { deliveredAt })) return false;
    return true;
  }
  function invoiceMatches(invoice: any, where: any): boolean {
    if (where.AND) return (where.AND as any[]).every((cond) => invoiceMatches(invoice, cond));
    const { id, status, shipment, dueDate } = where;
    if (id !== undefined && !matches(invoice, { id })) return false;
    if (status !== undefined && !matches(invoice, { status })) return false;
    if (shipment?.order?.customerId !== undefined && invoiceCustomerId(invoice) !== shipment.order.customerId) return false;
    if (dueDate !== undefined && !matches(invoice, { dueDate })) return false;
    return true;
  }

  function resolveShipmentInclude(shipment: any, include: any = {}) {
    const result: any = { ...shipment };
    if (include.order) {
      const order = orders.get(shipment.orderId);
      result.order = { id: order.id, pickupAddress: order.pickupAddress, deliveryAddress: order.deliveryAddress, status: order.status };
    }
    if (include.driver) {
      const driver = shipment.driverId ? users.get(shipment.driverId) : null;
      result.driver = driver ? { fullName: driver.fullName } : null;
    }
    if (include.proofOfDelivery) {
      const pod = proofOfDeliveries.get(shipment.id);
      result.proofOfDelivery = pod ? { photoUrl: pod.photoUrl, signatureUrl: pod.signatureUrl, notes: pod.notes } : null;
    }
    if (include.statusHistory) {
      result.statusHistory = statusHistories
        .filter((h) => h.shipmentId === shipment.id)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((h) => ({ toStatus: h.toStatus, createdAt: h.createdAt }));
    }
    return result;
  }

  function resolveInvoiceInclude(invoice: any, include: any = {}) {
    const result: any = { ...invoice };
    if (include.payments) {
      result.payments = payments
        .filter((p) => p.invoiceId === invoice.id)
        .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())
        .map((p) => ({ amountPaid: p.amountPaid, method: p.method, paidAt: p.paidAt }));
    }
    return result;
  }

  const fake: any = {
    customer: { findUnique: async () => null },
    order: {
      create: async ({ data }: any) => {
        const order = { id: nextOrderId++, declaredAmount: null, deliveryFee: null, status: 'pending', createdByCustomerUserId: null, createdAt: new Date(), ...data };
        orders.set(order.id, order);
        return order;
      },
      findMany: async ({ where, skip = 0, take = Infinity }: any) =>
        [...orders.values()].filter((o) => orderMatches(o, where)).slice(skip, skip + take),
      count: async ({ where }: any) => [...orders.values()].filter((o) => orderMatches(o, where)).length,
      findFirst: async ({ where, include }: any) => {
        const order = [...orders.values()].find((o) => orderMatches(o, where));
        if (!order) return null;
        if (!include) return order;
        const shipment = [...shipments.values()].find((s) => s.orderId === order.id);
        return {
          ...order,
          shipment: shipment ? resolveShipmentInclude(shipment, { ...include.shipment?.select, proofOfDelivery: include.shipment?.select?.proofOfDelivery }) : null,
        };
      },
      findUnique: async ({ where }: any) => orders.get(where.id) ?? null,
      update: async ({ where, data }: any) => {
        const order = orders.get(where.id);
        Object.assign(order, data);
        return order;
      },
    },
    shipment: {
      findMany: async ({ where, include, skip = 0, take = Infinity }: any) =>
        [...shipments.values()]
          .filter((s) => shipmentMatches(s, where))
          .slice(skip, skip + take)
          .map((s) => resolveShipmentInclude(s, include)),
      count: async ({ where }: any) => [...shipments.values()].filter((s) => shipmentMatches(s, where)).length,
      findFirst: async ({ where, include }: any) => {
        const shipment = [...shipments.values()].find((s) => shipmentMatches(s, where));
        return shipment ? resolveShipmentInclude(shipment, include) : null;
      },
    },
    invoice: {
      findMany: async ({ where, include, select, skip = 0, take = Infinity }: any) => {
        const rows = [...invoices.values()].filter((i) => invoiceMatches(i, where)).slice(skip, skip + take);
        if (select) {
          return rows.map((i) => ({
            amount: i.amount,
            payments: payments.filter((p) => p.invoiceId === i.id).map((p) => ({ amountPaid: p.amountPaid })),
          }));
        }
        return rows.map((i) => resolveInvoiceInclude(i, include));
      },
      count: async ({ where }: any) => [...invoices.values()].filter((i) => invoiceMatches(i, where)).length,
      findFirst: async ({ where, include }: any) => {
        const invoice = [...invoices.values()].find((i) => invoiceMatches(i, where));
        return invoice ? resolveInvoiceInclude(invoice, include) : null;
      },
    },
    user: {
      findUnique: async ({ where }: any) => users.get(where.id) ?? null,
    },
    addOrder(overrides: any = {}) {
      const order = { id: nextOrderId++, customerId: 1, pickupAddress: 'A', deliveryAddress: 'B', declaredAmount: null, deliveryFee: new Prisma.Decimal('50.00'), status: 'pending', createdByCustomerUserId: null, createdAt: new Date(), ...overrides };
      orders.set(order.id, order);
      return order;
    },
    addShipment(orderId: number, overrides: any = {}) {
      const shipment = { id: nextShipmentId++, orderId, driverId: null, status: 'ready_for_dispatch', pickedUpAt: null, deliveredAt: null, createdAt: new Date(), ...overrides };
      shipments.set(shipment.id, shipment);
      return shipment;
    },
    addStatusHistory(shipmentId: number, toStatus: string, overrides: any = {}) {
      statusHistories.push({ id: statusHistories.length + 1, shipmentId, fromStatus: null, toStatus, changedById: 1, createdAt: new Date(), ...overrides });
    },
    addProofOfDelivery(shipmentId: number, overrides: any = {}) {
      proofOfDeliveries.set(shipmentId, { shipmentId, photoUrl: 'https://example.com/photo.jpg', signatureUrl: null, notes: null, photoPublicId: 'secret-public-id', uploadedAt: new Date(), ...overrides });
    },
    addDriver(overrides: any = {}) {
      const user = { id: nextUserId++, fullName: 'Dana Driver', email: 'dana@fleetflow.local', role: 'driver', isActive: true, ...overrides };
      users.set(user.id, user);
      return user;
    },
    addInvoice(shipmentId: number, overrides: any = {}) {
      const invoice = { id: nextInvoiceId++, shipmentId, invoiceNumber: `INV-${String(nextInvoiceId).padStart(6, '0')}`, amount: new Prisma.Decimal('50.00'), currency: 'usd', status: 'unpaid', dueDate: new Date(Date.now() + 86_400_000), paidAt: null, sentAt: null, createdAt: new Date(), ...overrides };
      invoices.set(invoice.id, invoice);
      return invoice;
    },
    addPayment(invoiceId: number, overrides: any = {}) {
      payments.push({ id: nextPaymentId++, invoiceId, amountPaid: new Prisma.Decimal('10.00'), method: 'cash', reference: null, recordedById: 1, stripePaymentIntentId: null, paidAt: new Date(), ...overrides });
    },
  };
  return fake;
}

describe('Portal API (supertest, real guards, faked Prisma)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof createFakePrisma>;
  let staffJwt: JwtService;
  let customerJwt: JwtService;

  const CUSTOMER_A = 100;
  const CUSTOMER_B = 101;

  async function signStaff(overrides: Record<string, unknown> = {}) {
    return staffJwt.signAsync({ sub: 1, email: 'admin@fleetflow.local', role: 'admin', type: 'staff', ...overrides });
  }
  async function signCustomer(customerId: number, overrides: Record<string, unknown> = {}) {
    return customerJwt.signAsync({ sub: customerId * 10, customerId, type: 'customer', ...overrides });
  }

  beforeEach(async () => {
    prisma = createFakePrisma();
    staffJwt = new JwtService({ secret: 'test-staff-secret', signOptions: { expiresIn: '15m' } });
    customerJwt = new JwtService({ secret: 'test-customer-secret', signOptions: { expiresIn: '15m' } });

    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, PortalModule, OrdersModule],
      providers: [
        { provide: JwtService, useValue: staffJwt },
        { provide: CUSTOMER_JWT_SERVICE, useValue: customerJwt },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('tenant isolation', () => {
    it("customer A gets 404 for customer B's order, shipment, and invoice by id", async () => {
      const orderB = prisma.addOrder({ customerId: CUSTOMER_B });
      const shipmentB = prisma.addShipment(orderB.id, { status: 'in_transit' });
      const invoiceB = prisma.addInvoice(shipmentB.id);
      const tokenA = await signCustomer(CUSTOMER_A);

      await request(app.getHttpServer()).get(`/api/v1/portal/orders/${orderB.id}`).set('Authorization', `Bearer ${tokenA}`).expect(404);
      await request(app.getHttpServer()).get(`/api/v1/portal/shipments/${shipmentB.id}`).set('Authorization', `Bearer ${tokenA}`).expect(404);
      await request(app.getHttpServer()).get(`/api/v1/portal/invoices/${invoiceB.id}`).set('Authorization', `Bearer ${tokenA}`).expect(404);
    });

    it("customer A cannot cancel customer B's order (404, not 403)", async () => {
      const orderB = prisma.addOrder({ customerId: CUSTOMER_B, status: 'pending' });
      const tokenA = await signCustomer(CUSTOMER_A);
      await request(app.getHttpServer()).patch(`/api/v1/portal/orders/${orderB.id}/cancel`).set('Authorization', `Bearer ${tokenA}`).expect(404);
    });

    it('lists contain only the calling customer\'s data', async () => {
      prisma.addOrder({ customerId: CUSTOMER_A });
      prisma.addOrder({ customerId: CUSTOMER_A });
      const orderB = prisma.addOrder({ customerId: CUSTOMER_B });
      prisma.addShipment(orderB.id);
      const tokenA = await signCustomer(CUSTOMER_A);

      const res = await request(app.getHttpServer()).get('/api/v1/portal/orders').set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.total).toBe(2);

      const shipmentsRes = await request(app.getHttpServer()).get('/api/v1/portal/shipments').set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(shipmentsRes.body.data).toHaveLength(0); // customer A has no shipments at all
    });

    it('rejects a customerId sent in the body with 400 (forbidNonWhitelisted)', async () => {
      const tokenA = await signCustomer(CUSTOMER_A);
      await request(app.getHttpServer())
        .post('/api/v1/portal/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ pickupAddress: 'X', deliveryAddress: 'Y', customerId: 999 })
        .expect(400);
    });

    it('rejects a staff token on every portal route', async () => {
      const order = prisma.addOrder({ customerId: CUSTOMER_A });
      const shipment = prisma.addShipment(order.id);
      const invoice = prisma.addInvoice(shipment.id);
      const staffToken = await signStaff();

      const routes: Array<[string, string]> = [
        ['get', '/api/v1/portal/orders'],
        ['get', `/api/v1/portal/orders/${order.id}`],
        ['post', '/api/v1/portal/orders'],
        ['patch', `/api/v1/portal/orders/${order.id}/cancel`],
        ['get', '/api/v1/portal/shipments'],
        ['get', `/api/v1/portal/shipments/${shipment.id}`],
        ['get', '/api/v1/portal/invoices'],
        ['get', `/api/v1/portal/invoices/${invoice.id}`],
        ['get', '/api/v1/portal/dashboard'],
      ];

      for (const [method, path] of routes) {
        await (request(app.getHttpServer()) as any)[method](path).set('Authorization', `Bearer ${staffToken}`).expect(401);
      }
    });

    it('rejects a customer token on a staff route (regression)', async () => {
      const tokenA = await signCustomer(CUSTOMER_A);
      await request(app.getHttpServer()).get('/api/v1/orders').set('Authorization', `Bearer ${tokenA}`).expect(401);
    });
  });

  describe('order creation and cancellation rules', () => {
    it('creates an order with no delivery fee and stamps the creating customer user', async () => {
      const tokenA = await signCustomer(CUSTOMER_A);
      const res = await request(app.getHttpServer())
        .post('/api/v1/portal/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ pickupAddress: '1 Main St', deliveryAddress: '2 Oak Ave' })
        .expect(201);

      expect(res.body.status).toBe('pending');
      expect(res.body.deliveryFee).toBeUndefined();
    });

    it('cannot cancel a processing order (409)', async () => {
      const order = prisma.addOrder({ customerId: CUSTOMER_A, status: 'processing' });
      const tokenA = await signCustomer(CUSTOMER_A);
      await request(app.getHttpServer()).patch(`/api/v1/portal/orders/${order.id}/cancel`).set('Authorization', `Bearer ${tokenA}`).expect(409);
    });
  });

  describe('response shapes never leak internal fields', () => {
    it('shipment detail: driver is first-name-only while in_transit, and never changedById/email/id', async () => {
      const order = prisma.addOrder({ customerId: CUSTOMER_A });
      const driver = prisma.addDriver({ fullName: 'Jordan Rivera' });
      const shipment = prisma.addShipment(order.id, { driverId: driver.id, status: 'in_transit', pickedUpAt: new Date() });
      prisma.addStatusHistory(shipment.id, 'ready_for_dispatch');
      prisma.addStatusHistory(shipment.id, 'picked_up', { changedById: 42 });
      prisma.addStatusHistory(shipment.id, 'in_transit', { changedById: 42 });
      const tokenA = await signCustomer(CUSTOMER_A);

      const res = await request(app.getHttpServer()).get(`/api/v1/portal/shipments/${shipment.id}`).set('Authorization', `Bearer ${tokenA}`).expect(200);

      expect(res.body.driver).toEqual({ firstName: 'Jordan' });
      expect(res.body.driver.email).toBeUndefined();
      expect(res.body.driver.id).toBeUndefined();
      for (const entry of res.body.timeline) {
        expect(entry.changedById).toBeUndefined();
        expect(Object.keys(entry).sort()).toEqual(['at', 'status']);
      }
    });

    it('shipment detail: driver is hidden before pickup and after delivery', async () => {
      const order = prisma.addOrder({ customerId: CUSTOMER_A });
      const driver = prisma.addDriver();
      const shipment = prisma.addShipment(order.id, { driverId: driver.id, status: 'ready_for_dispatch' });
      const tokenA = await signCustomer(CUSTOMER_A);

      const res = await request(app.getHttpServer()).get(`/api/v1/portal/shipments/${shipment.id}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(res.body.driver).toBeNull();
    });

    it('shipment detail: proof of delivery never exposes photoPublicId/signaturePublicId', async () => {
      const order = prisma.addOrder({ customerId: CUSTOMER_A });
      const shipment = prisma.addShipment(order.id, { status: 'delivered', deliveredAt: new Date() });
      prisma.addProofOfDelivery(shipment.id);
      const tokenA = await signCustomer(CUSTOMER_A);

      const res = await request(app.getHttpServer()).get(`/api/v1/portal/shipments/${shipment.id}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(res.body.proofOfDelivery.photoUrl).toBeDefined();
      expect(res.body.proofOfDelivery.photoPublicId).toBeUndefined();
      expect(res.body.proofOfDelivery.signaturePublicId).toBeUndefined();
    });

    it('invoice detail never exposes recordedById, stripePaymentIntentId, or publicId-style fields', async () => {
      const order = prisma.addOrder({ customerId: CUSTOMER_A });
      const shipment = prisma.addShipment(order.id, { status: 'delivered' });
      const invoice = prisma.addInvoice(shipment.id, { amount: new Prisma.Decimal('100.00') });
      prisma.addPayment(invoice.id, { amountPaid: new Prisma.Decimal('40.00'), recordedById: 7, stripePaymentIntentId: 'pi_secret_123' });
      const tokenA = await signCustomer(CUSTOMER_A);

      const res = await request(app.getHttpServer()).get(`/api/v1/portal/invoices/${invoice.id}`).set('Authorization', `Bearer ${tokenA}`).expect(200);

      expect(res.body.amountPaid).toBe('40');
      expect(res.body.balance).toBe('60');
      expect(res.body.payments).toEqual([{ amount: '40', method: 'cash', paidAt: expect.any(String) }]);
      expect(JSON.stringify(res.body)).not.toMatch(/recordedById|stripePaymentIntentId|publicId/);
    });

    it('order detail never exposes a raw deliveryFee or customerId', async () => {
      const order = prisma.addOrder({ customerId: CUSTOMER_A, deliveryFee: new Prisma.Decimal('75.00') });
      const tokenA = await signCustomer(CUSTOMER_A);

      const res = await request(app.getHttpServer()).get(`/api/v1/portal/orders/${order.id}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(res.body.deliveryFee).toBeUndefined();
      expect(res.body.customerId).toBeUndefined();
    });
  });

  describe('dashboard', () => {
    it('scopes every count and total to the calling customer only', async () => {
      const orderA1 = prisma.addOrder({ customerId: CUSTOMER_A });
      const shipmentA1 = prisma.addShipment(orderA1.id, { status: 'in_transit' });
      prisma.addInvoice(shipmentA1.id, { amount: new Prisma.Decimal('80.00'), status: 'unpaid', dueDate: new Date(Date.now() - 86_400_000) });

      const orderB1 = prisma.addOrder({ customerId: CUSTOMER_B });
      const shipmentB1 = prisma.addShipment(orderB1.id, { status: 'in_transit' });
      prisma.addInvoice(shipmentB1.id, { amount: new Prisma.Decimal('500.00'), status: 'unpaid', dueDate: new Date(Date.now() - 86_400_000) });

      const tokenA = await signCustomer(CUSTOMER_A);
      const res = await request(app.getHttpServer()).get('/api/v1/portal/dashboard').set('Authorization', `Bearer ${tokenA}`).expect(200);

      expect(res.body.activeShipments).toBe(1);
      expect(res.body.unpaidInvoiceCount).toBe(1);
      expect(res.body.overdueInvoiceCount).toBe(1);
      expect(res.body.totalOutstandingBalance).toBe('80'); // not 580 — B's invoice must not leak in
    });
  });
});
