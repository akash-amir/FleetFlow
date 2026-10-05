import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../permissions.js';

export const PERMISSIONS_KEY = 'permissions';

/** Declares which permission strings (see common/permissions.ts) a route requires. */
export const Permissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);
