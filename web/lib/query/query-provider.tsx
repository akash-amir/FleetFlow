'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * TanStack Query over a hand-rolled useQuery hook: once FleetFlow has 5+
 * list views (orders, shipments, invoices, customers, ...), request
 * caching, refetch-on-window-focus, and de-duplication of identical
 * in-flight requests all start to matter, and this is the standard,
 * well-understood answer to all three rather than reimplementing a smaller
 * version of it per feature as each one gets built. No feature calls
 * useQuery yet — this module only establishes the provider so every future
 * one can.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
