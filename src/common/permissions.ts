import { Role } from '@prisma/client';

/**
 * Permission strings, derived from the matrix in PROJECT.md Section 6.
 * Role alone is necessary but not sufficient for driver-scoped actions —
 * callers must still check resource ownership (e.g. shipment.driverId === user.sub).
 */
export type Permission =
  | 'user:create'
  | 'user:read'
  | 'user:update'
  | 'user:deactivate'
  | 'user:activate'
  | 'user:resetPassword'
  | 'customer:create'
  | 'customer:read'
  | 'order:create'
  | 'order:read'
  | 'shipment:create'
  | 'shipment:assign_driver'
  | 'shipment:read'
  | 'shipment:read_own'
  | 'shipment:update_status_own'
  | 'pod:upload_own'
  | 'invoice:read'
  | 'invoice:mark_paid'
  | 'invoice:generate'
  | 'dashboard:view:full'
  | 'dashboard:view:operational';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    'user:create',
    'user:read',
    'user:update',
    'user:deactivate',
    'user:activate',
    'user:resetPassword',
    'customer:create',
    'customer:read',
    'order:create',
    'order:read',
    'shipment:create',
    'shipment:assign_driver',
    'shipment:read',
    'invoice:read',
    'invoice:mark_paid',
    'invoice:generate',
    'dashboard:view:full',
  ],
  dispatcher: [
    'customer:create',
    'customer:read',
    'order:create',
    'order:read',
    'shipment:create',
    'shipment:assign_driver',
    'shipment:read',
    'invoice:read',
    'invoice:mark_paid',
    'invoice:generate',
    'dashboard:view:operational',
  ],
  driver: ['shipment:update_status_own', 'shipment:read_own', 'pod:upload_own'],
};
