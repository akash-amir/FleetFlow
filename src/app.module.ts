import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './modules/auth/module/auth.module.js';
import { UsersModule } from './modules/users/module/users.module.js';
import { CustomersModule } from './modules/customers/module/customers.module.js';
import { OrdersModule } from './modules/orders/module/orders.module.js';
import { ShipmentsModule } from './modules/shipments/module/shipments.module.js';
import { InvoicesModule } from './modules/invoices/module/invoices.module.js';
import { RealtimeModule } from './modules/realtime/module/realtime.module.js';
import { PortalAuthModule } from './modules/portal-auth/module/portal-auth.module.js';
import { PortalModule } from './modules/portal/module/portal.module.js';
import { PaymentsModule } from './modules/payments/module/payments.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from './common/guards/permissions.guard.js';
import { CustomerJwtModule } from './common/jwt/customer-jwt.module.js';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    PrismaModule,
    CustomerJwtModule,
    AuthModule,
    UsersModule,
    CustomersModule,
    OrdersModule,
    ShipmentsModule,
    InvoicesModule,
    RealtimeModule,
    PortalAuthModule,
    PortalModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
