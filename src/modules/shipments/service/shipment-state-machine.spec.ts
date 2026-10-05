import { Role, ShipmentStatus } from '@prisma/client';
import { canActorTransition, canTransition } from './shipment-state-machine.js';

const ALL_STATUSES = Object.values(ShipmentStatus);
const ALL_ROLES = Object.values(Role);

const ALLOWED: Record<ShipmentStatus, ShipmentStatus[]> = {
  ready_for_dispatch: ['picked_up', 'cancelled'],
  picked_up: ['in_transit', 'failed'],
  in_transit: ['delivered', 'failed'],
  failed: ['ready_for_dispatch'],
  delivered: [],
  cancelled: [],
};

// "to" values each role may trigger, PER allowed transition — used below to
// derive the exhaustive expected matrix rather than re-hardcoding it.
function actorAllows(role: Role, from: ShipmentStatus, to: ShipmentStatus): boolean {
  if (role === 'driver') return ['picked_up', 'in_transit', 'delivered', 'failed'].includes(to);
  return to === 'cancelled' || (from === 'failed' && to === 'ready_for_dispatch');
}

describe('shipment-state-machine', () => {
  describe('canTransition — every pair in the 6x6 matrix', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const expected = ALLOWED[from].includes(to);
        it(`${from} -> ${to} is ${expected ? 'allowed' : 'rejected'}`, () => {
          expect(canTransition(from, to)).toBe(expected);
        });
      }
    }
  });

  describe('canActorTransition — every pair, for every role', () => {
    for (const role of ALL_ROLES) {
      for (const from of ALL_STATUSES) {
        for (const to of ALL_STATUSES) {
          const expected = ALLOWED[from].includes(to) && actorAllows(role, from, to);
          it(`${role}: ${from} -> ${to} is ${expected ? 'allowed' : 'rejected'}`, () => {
            expect(canActorTransition(role, from, to)).toBe(expected);
          });
        }
      }
    }
  });

  it('drivers can never trigger cancelled or the failed->ready_for_dispatch retry', () => {
    expect(canActorTransition('driver', 'ready_for_dispatch', 'cancelled')).toBe(false);
    expect(canActorTransition('driver', 'failed', 'ready_for_dispatch')).toBe(false);
  });

  it('admin/dispatcher can never trigger the forward-progress transitions', () => {
    for (const role of ['admin', 'dispatcher'] as const) {
      expect(canActorTransition(role, 'ready_for_dispatch', 'picked_up')).toBe(false);
      expect(canActorTransition(role, 'picked_up', 'in_transit')).toBe(false);
      expect(canActorTransition(role, 'in_transit', 'delivered')).toBe(false);
      expect(canActorTransition(role, 'picked_up', 'failed')).toBe(false);
    }
  });
});
