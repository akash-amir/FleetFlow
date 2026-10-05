import type { Provider } from '@nestjs/common';
import Stripe from 'stripe';

/** Injection token — swap in a fake in tests instead of hitting real Stripe. */
export const STRIPE_CLIENT = 'STRIPE_CLIENT';

// Matches whatever `stripe` (see package.json) resolves to today. Pinned
// explicitly here rather than left to the SDK's own bundled default, so an
// SDK upgrade can't silently change request/response shapes under us —
// bumping the API version is then a deliberate, visible change to this line
// (or STRIPE_API_VERSION), not a side effect of `npm update`.
const DEFAULT_API_VERSION = '2026-09-30.endive';

export const StripeClientProvider: Provider = {
  provide: STRIPE_CLIENT,
  useFactory: () =>
    new Stripe(process.env.STRIPE_SECRET_KEY!, {
      // The installed SDK's types only reflect its own bundled version
      // (LatestApiVersion) — the cast is safe because STRIPE_API_VERSION is
      // meant to pin exactly that string; a real version mismatch would be
      // caught by Stripe at request time, not by this cast.
      apiVersion: (process.env.STRIPE_API_VERSION || DEFAULT_API_VERSION) as Stripe.LatestApiVersion,
    }),
};
