import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitterModule, EventEmitter2 } from '@nestjs/event-emitter';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { JwtService } from '@nestjs/jwt';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CUSTOMER_JWT_SERVICE } from '../../../common/jwt/customer-jwt.provider.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeService, OPS_ROOM, driverRoom } from '../service/realtime.service.js';

const ADMIN = { id: 1, role: 'admin' as const, isActive: true };
const DRIVER_A = { id: 2, role: 'driver' as const, isActive: true };
const DRIVER_B = { id: 3, role: 'driver' as const, isActive: true };
const INACTIVE_DRIVER = { id: 4, role: 'driver' as const, isActive: false };
const USERS = new Map([ADMIN, DRIVER_A, DRIVER_B, INACTIVE_DRIVER].map((u) => [u.id, u]));

const CUSTOMER_A_USER = { id: 10, customerId: 100, isActive: true };
const CUSTOMER_B_USER = { id: 11, customerId: 101, isActive: true };
const CUSTOMER_USERS = new Map([CUSTOMER_A_USER, CUSTOMER_B_USER].map((u) => [u.id, u]));

const INVOICES = new Map([
  [900, { id: 900, status: 'paid', customerId: CUSTOMER_A_USER.customerId }],
  [901, { id: 901, status: 'paid', customerId: CUSTOMER_B_USER.customerId }],
]);

function once(socket: ClientSocket, event: string, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for '${event}'`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Asserts `event` is NOT received within `graceMs` — the only way to prove a room/message had no effect. */
function expectNoEvent(socket: ClientSocket, event: string, graceMs = 300): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = () => {
      clearTimeout(timer);
      reject(new Error(`Unexpectedly received '${event}'`));
    };
    socket.once(event, handler);
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, graceMs);
  });
}

describe('RealtimeGateway (socket.io-client, ephemeral port, faked Prisma)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let customerJwt: JwtService;
  let events: EventEmitter2;
  let baseUrl: string;
  let sockets: ClientSocket[] = [];

  async function signToken(user: { id: number; role: string }, opts?: Record<string, unknown>) {
    return jwt.signAsync({ sub: user.id, email: 'x@example.com', role: user.role }, opts);
  }

  async function signCustomerToken(user: { id: number; customerId: number }, opts?: Record<string, unknown>) {
    return customerJwt.signAsync({ sub: user.id, customerId: user.customerId, type: 'customer' }, opts);
  }

  function connect(token: string | undefined): ClientSocket {
    const socket = io(baseUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    return socket;
  }

  beforeAll(async () => {
    jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '15m' } });
    customerJwt = new JwtService({ secret: 'test-customer-secret', signOptions: { expiresIn: '15m' } });
    const fakePrisma = {
      user: { findUnique: async ({ where }: any) => USERS.get(where.id) ?? null },
      customerUser: { findUnique: async ({ where }: any) => CUSTOMER_USERS.get(where.id) ?? null },
      invoice: {
        findUnique: async ({ where }: any) => {
          const invoice = INVOICES.get(where.id);
          return invoice ? { status: invoice.status, shipment: { order: { customerId: invoice.customerId } } } : null;
        },
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        RealtimeGateway,
        RealtimeService,
        { provide: JwtService, useValue: jwt },
        { provide: CUSTOMER_JWT_SERVICE, useValue: customerJwt },
        { provide: PrismaService, useValue: fakePrisma },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    events = moduleRef.get(EventEmitter2);
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://localhost:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    for (const socket of sockets) socket.disconnect();
    sockets = [];
  });

  it('a valid staff token connects and reaches the right room for their role', async () => {
    const adminToken = await signToken(ADMIN);
    const driverToken = await signToken(DRIVER_A);
    const adminSocket = connect(adminToken);
    const driverSocket = connect(driverToken);
    await Promise.all([once(adminSocket, 'connect'), once(driverSocket, 'connect')]);

    const adminReceived = once(adminSocket, 'shipment:updated');
    const driverReceived = once(driverSocket, 'shipment:updated');
    events.emit('shipment.status.changed', {
      shipmentId: 100,
      orderId: 1000,
      customerId: 999, // no customer socket listening on this room in this test
      fromStatus: 'picked_up',
      toStatus: 'in_transit',
      driverId: DRIVER_A.id,
      changedById: ADMIN.id,
      changedAt: new Date(),
    });

    const [adminPayload, driverPayload] = await Promise.all([adminReceived, driverReceived]);
    expect(adminPayload.shipmentId).toBe(100); // admin is in 'ops', which gets every update
    expect(driverPayload.shipmentId).toBe(100); // driver is in their own room, which got this one too
  });

  it('rejects a connection with no token', async () => {
    const socket = connect(undefined);
    await once(socket, 'disconnect');
    expect(socket.connected).toBe(false);
  });

  it('rejects a connection with an invalid token', async () => {
    const socket = connect('not-a-real-token');
    await once(socket, 'disconnect');
    expect(socket.connected).toBe(false);
  });

  it('rejects a connection with an expired token', async () => {
    const expiredToken = await signToken(ADMIN, { expiresIn: '1s' });
    await new Promise((resolve) => setTimeout(resolve, 1100)); // let it actually expire
    const socket = connect(expiredToken);
    await once(socket, 'disconnect');
    expect(socket.connected).toBe(false);
  });

  it('rejects a connection for a deactivated user', async () => {
    const token = await signToken(INACTIVE_DRIVER);
    const socket = connect(token);
    await once(socket, 'disconnect');
    expect(socket.connected).toBe(false);
  });

  it('a driver receives events only for themself; another driver receives nothing; ops receives all', async () => {
    const opsToken = await signToken(ADMIN);
    const driverAToken = await signToken(DRIVER_A);
    const driverBToken = await signToken(DRIVER_B);
    const opsSocket = connect(opsToken);
    const driverASocket = connect(driverAToken);
    const driverBSocket = connect(driverBToken);
    await Promise.all([once(opsSocket, 'connect'), once(driverASocket, 'connect'), once(driverBSocket, 'connect')]);

    const opsReceived = once(opsSocket, 'shipment:updated');
    const driverAReceived = once(driverASocket, 'shipment:updated');
    const driverBNeverReceives = expectNoEvent(driverBSocket, 'shipment:updated');

    events.emit('shipment.status.changed', {
      shipmentId: 200,
      orderId: 2000,
      customerId: 999,
      fromStatus: 'ready_for_dispatch',
      toStatus: 'picked_up',
      driverId: DRIVER_A.id,
      changedById: ADMIN.id,
      changedAt: new Date(),
    });

    await Promise.all([opsReceived, driverAReceived, driverBNeverReceives]);
  });

  it('a client cannot join another room by sending a join message', async () => {
    const driverAToken = await signToken(DRIVER_A);
    const driverASocket = connect(driverAToken);
    await once(driverASocket, 'connect');

    // No handler exists for this at all — it must be a silent no-op.
    driverASocket.emit('join', driverRoom(DRIVER_B.id));
    driverASocket.emit('join', OPS_ROOM);

    const driverANeverReceives = expectNoEvent(driverASocket, 'shipment:updated');
    events.emit('shipment.status.changed', {
      shipmentId: 300,
      orderId: 3000,
      customerId: 999,
      fromStatus: 'picked_up',
      toStatus: 'in_transit',
      driverId: DRIVER_B.id, // scoped to driver B only
      changedById: ADMIN.id,
      changedAt: new Date(),
    });

    await driverANeverReceives;
  });

  it('is disconnected with reason token_expired when its token expires', async () => {
    const shortLivedToken = await signToken(ADMIN, { expiresIn: '1s' });
    const socket = connect(shortLivedToken);
    await once(socket, 'connect');

    // Both listeners must be attached before either fires — the server emits
    // 'disconnect_reason' and then disconnects in the same tick, so
    // attaching 'disconnect' only after awaiting 'disconnect_reason' can
    // miss it.
    const reasonPromise = once(socket, 'disconnect_reason', 3000);
    const disconnectPromise = once(socket, 'disconnect', 3000);
    expect(await reasonPromise).toEqual({ reason: 'token_expired' });
    await disconnectPromise;
  });

  it('a status change emits exactly one shipment:updated to each relevant room', async () => {
    const opsToken = await signToken(ADMIN);
    const driverAToken = await signToken(DRIVER_A);
    const opsSocket = connect(opsToken);
    const driverASocket = connect(driverAToken);
    await Promise.all([once(opsSocket, 'connect'), once(driverASocket, 'connect')]);

    const opsEvents: unknown[] = [];
    const driverEvents: unknown[] = [];
    opsSocket.on('shipment:updated', (p) => opsEvents.push(p));
    driverASocket.on('shipment:updated', (p) => driverEvents.push(p));

    events.emit('shipment.status.changed', {
      shipmentId: 400,
      orderId: 4000,
      customerId: 999,
      fromStatus: 'in_transit',
      toStatus: 'delivered',
      driverId: DRIVER_A.id,
      changedById: ADMIN.id,
      changedAt: new Date(),
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(opsEvents).toHaveLength(1);
    expect(driverEvents).toHaveLength(1);
  });

  it('assign-driver emits shipment:assigned to ops and to the assigned driver', async () => {
    const opsToken = await signToken(ADMIN);
    const driverAToken = await signToken(DRIVER_A);
    const opsSocket = connect(opsToken);
    const driverASocket = connect(driverAToken);
    await Promise.all([once(opsSocket, 'connect'), once(driverASocket, 'connect')]);

    const opsReceived = once(opsSocket, 'shipment:assigned');
    const driverReceived = once(driverASocket, 'shipment:assigned');
    events.emit('shipment.driver.assigned', { shipmentId: 500, driverId: DRIVER_A.id, assignedById: ADMIN.id });

    const [opsPayload, driverPayload] = await Promise.all([opsReceived, driverReceived]);
    expect(opsPayload).toEqual({ shipmentId: 500, driverId: DRIVER_A.id, assignedById: ADMIN.id });
    expect(driverPayload).toEqual({ shipmentId: 500, driverId: DRIVER_A.id, assignedById: ADMIN.id });
  });

  it('a customer token connects and joins their own customer room', async () => {
    const token = await signCustomerToken(CUSTOMER_A_USER);
    const socket = connect(token);
    await once(socket, 'connect');
    expect(socket.connected).toBe(true);
  });

  it('rejects a connection for a deactivated customer user', async () => {
    const token = await signCustomerToken({ id: 999, customerId: 999 });
    const socket = connect(token);
    await once(socket, 'disconnect');
    expect(socket.connected).toBe(false);
  });

  it('customer A receives only its own shipment updates, with no driver info; customer B receives nothing', async () => {
    const customerAToken = await signCustomerToken(CUSTOMER_A_USER);
    const customerBToken = await signCustomerToken(CUSTOMER_B_USER);
    const customerASocket = connect(customerAToken);
    const customerBSocket = connect(customerBToken);
    await Promise.all([once(customerASocket, 'connect'), once(customerBSocket, 'connect')]);

    const customerAReceived = once(customerASocket, 'shipment:updated');
    const customerBNeverReceives = expectNoEvent(customerBSocket, 'shipment:updated');

    events.emit('shipment.status.changed', {
      shipmentId: 600,
      orderId: 6000,
      customerId: CUSTOMER_A_USER.customerId,
      fromStatus: 'picked_up',
      toStatus: 'in_transit',
      driverId: DRIVER_A.id,
      changedById: ADMIN.id,
      changedAt: new Date(),
    });

    const [customerPayload] = await Promise.all([customerAReceived, customerBNeverReceives]);
    expect(customerPayload).toEqual({
      shipmentId: 600,
      orderId: 6000,
      toStatus: 'in_transit',
      changedAt: expect.any(String),
    });
    expect(customerPayload.driverId).toBeUndefined();
    expect(customerPayload.fromStatus).toBeUndefined();
    expect(customerPayload.changedById).toBeUndefined();
  });

  it('a customer socket is disconnected with reason token_expired when its token expires', async () => {
    const shortLivedToken = await signCustomerToken(CUSTOMER_A_USER, { expiresIn: '1s' });
    const socket = connect(shortLivedToken);
    await once(socket, 'connect');

    const reasonPromise = once(socket, 'disconnect_reason', 3000);
    const disconnectPromise = once(socket, 'disconnect', 3000);
    expect(await reasonPromise).toEqual({ reason: 'token_expired' });
    await disconnectPromise;
  });

  it('invoice.paid relays invoice:updated to ops and to the right customer room only', async () => {
    const opsToken = await signToken(ADMIN);
    const customerAToken = await signCustomerToken(CUSTOMER_A_USER);
    const customerBToken = await signCustomerToken(CUSTOMER_B_USER);
    const opsSocket = connect(opsToken);
    const customerASocket = connect(customerAToken);
    const customerBSocket = connect(customerBToken);
    await Promise.all([once(opsSocket, 'connect'), once(customerASocket, 'connect'), once(customerBSocket, 'connect')]);

    const opsReceived = once(opsSocket, 'invoice:updated');
    const customerAReceived = once(customerASocket, 'invoice:updated');
    const customerBNeverReceives = expectNoEvent(customerBSocket, 'invoice:updated');

    events.emit('invoice.paid', { invoiceId: 900 }); // belongs to customer A

    const [opsPayload, customerAPayload] = await Promise.all([opsReceived, customerAReceived, customerBNeverReceives]);
    expect(opsPayload).toEqual({ invoiceId: 900, status: 'paid' });
    expect(customerAPayload).toEqual({ invoiceId: 900, status: 'paid' });
  });
});
