import type { Role, ShipmentStatus } from '@prisma/client';

/** Allowed forward/retry transitions. `delivered` and `cancelled` are terminal (no outgoing edges). */
const TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  ready_for_dispatch: ['picked_up', 'cancelled'],
  picked_up: ['in_transit', 'failed'],
  in_transit: ['delivered', 'failed'],
  failed: ['ready_for_dispatch'],
  delivered: [],
  cancelled: [],
};

/** Is `from -> to` a transition that exists at all, regardless of who's asking? */
export function canTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The "to" values a driver may drive a shipment toward — i.e. the forward-progress half of the machine. */
const DRIVER_TRIGGERABLE_TO: ShipmentStatus[] = ['picked_up', 'in_transit', 'delivered', 'failed'];

/**
 * Is `from -> to` both a valid transition AND one this role is allowed to
 * trigger? Drivers drive the shipment forward (or report failure);
 * admin/dispatcher only cancel a shipment or retry one that failed —
 * they never themselves mark picked_up/in_transit/delivered.
 */
export function canActorTransition(role: Role, from: ShipmentStatus, to: ShipmentStatus): boolean {
  if (!canTransition(from, to)) return false;
  if (role === 'driver') return DRIVER_TRIGGERABLE_TO.includes(to);
  return to === 'cancelled' || (from === 'failed' && to === 'ready_for_dispatch');
}
