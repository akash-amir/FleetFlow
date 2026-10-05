'use client';

import type { ReactNode } from 'react';
import { useRole } from '../hooks/use-role';
import type { Role } from '../types/auth.types';

interface RequireRoleProps {
  roles: Role[];
  children: ReactNode;
  /** Rendered instead of children when the current role isn't allowed. Defaults to rendering nothing. */
  fallback?: ReactNode;
}

/** Gates its children to the given roles — purely a rendering mechanism, not a security boundary: the backend enforces every permission independently and must never be trusted to behave only because the UI hid a button. */
export function RequireRole({ roles, children, fallback = null }: RequireRoleProps) {
  const role = useRole();
  if (!role || !roles.includes(role)) return <>{fallback}</>;
  return <>{children}</>;
}
