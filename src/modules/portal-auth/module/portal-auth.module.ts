import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { CustomerJwtModule } from '../../../common/jwt/customer-jwt.module.js';
import { EmailModule } from '../../../common/email/email.module.js';
import { PortalAuthController } from '../controller/portal-auth.controller.js';
import { PortalAuthService } from '../service/portal-auth.service.js';

@Module({
  imports: [
    CustomerJwtModule,
    EmailModule,
    // Registered here only (not globally via APP_GUARD) — the rest of the
    // API is deliberately not throttled; only this module's controller
    // opts in per-route via @UseGuards(ThrottlerGuard) + @Throttle(...).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 5 }]),
  ],
  controllers: [PortalAuthController],
  providers: [PortalAuthService],
})
export class PortalAuthModule {}
