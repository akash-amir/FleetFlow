import { SetMetadata } from '@nestjs/common';

export const CUSTOMER_ONLY_KEY = 'customerOnly';

/**
 * Marks a route as customer-portal-only. JwtAuthGuard verifies the token
 * with the CUSTOMER secret and requires `type: 'customer'` on routes
 * carrying this; every other route requires a staff token instead — see
 * PROJECT.md Section 7 (Portal Security Rules).
 */
export const CustomerOnly = () => SetMetadata(CUSTOMER_ONLY_KEY, true);
