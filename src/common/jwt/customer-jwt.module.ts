import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CUSTOMER_JWT_SERVICE } from './customer-jwt.provider.js';

/**
 * A second, separately-secreted JwtService instance for customer portal
 * tokens. Kept apart from the default (staff) JwtService token so the two
 * token types can never be verified interchangeably — see JwtAuthGuard and
 * PROJECT.md Section 7 (Portal Security Rules).
 */
@Module({
  providers: [
    {
      provide: CUSTOMER_JWT_SERVICE,
      useFactory: () =>
        new JwtService({
          secret: process.env.JWT_CUSTOMER_ACCESS_SECRET,
          signOptions: { expiresIn: '15m' },
        }),
    },
  ],
  exports: [CUSTOMER_JWT_SERVICE],
})
export class CustomerJwtModule {}
