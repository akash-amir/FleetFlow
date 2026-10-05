'use client';

import { useAuth } from '../auth-context';
import type { Role } from '../types/auth.types';

export function useRole(): Role | null {
  return useAuth().user?.role ?? null;
}
