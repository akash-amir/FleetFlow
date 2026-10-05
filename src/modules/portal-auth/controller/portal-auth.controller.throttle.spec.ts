import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { PortalAuthController } from './portal-auth.controller.js';
import { PortalAuthService } from '../service/portal-auth.service.js';

/**
 * Throttling is a route-level (@UseGuards(ThrottlerGuard)) concern, so it
 * can only be proven by actually driving HTTP requests through Nest's guard
 * pipeline — a fake-service unit test can't exercise a Guard at all. The
 * login logic itself is already covered in portal-auth.service.spec.ts; this
 * fake PortalAuthService always rejects, which is irrelevant here — the
 * throttle counts requests regardless of the eventual response status.
 */
describe('PortalAuthController rate limiting', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const fakePortalAuthService = {
      login: async () => {
        throw new UnauthorizedException('Invalid credentials');
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 5 }])],
      controllers: [PortalAuthController],
      providers: [{ provide: PortalAuthService, useValue: fakePortalAuthService }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 once /login is called more than 5 times in a minute from the same IP', async () => {
    const agent = request(app.getHttpServer());
    for (let i = 0; i < 5; i++) {
      const res = await agent.post('/portal/auth/login').send({ email: 'x@example.com', password: 'wrong' });
      expect(res.status).toBe(401); // rejected by the (fake) service, but NOT throttled yet
    }

    const sixth = await agent.post('/portal/auth/login').send({ email: 'x@example.com', password: 'wrong' });
    expect(sixth.status).toBe(429);
  });
});
