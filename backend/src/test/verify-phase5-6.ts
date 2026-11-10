/* eslint-disable no-console */
import { ALLOWED_TRANSITIONS } from '../lib/tracking';

/**
 * Verifies the end-to-end OWN-network status transition graph required by Phase 5 & 6:
 * BOOKED -> PICKUP_SCHEDULED -> PICKED_UP -> AT_ORIGIN_HUB -> IN_TRANSIT -> AT_DESTINATION_HUB -> OUT_FOR_DELIVERY -> DELIVERED
 */
function main() {
  const ownFlow = [
    'BOOKED',
    'PICKUP_SCHEDULED',
    'PICKED_UP',
    'AT_ORIGIN_HUB',
    'IN_TRANSIT',
    'AT_DESTINATION_HUB',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
  ] as const;

  for (let i = 0; i < ownFlow.length - 1; i++) {
    const from = ownFlow[i];
    const to = ownFlow[i + 1];
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new Error(`Invalid transition edge in OWN flow: ${from} -> ${to}`);
    }
  }

  // Also check failure & RTO branches
  const branchChecks: Array<[keyof typeof ALLOWED_TRANSITIONS, keyof typeof ALLOWED_TRANSITIONS]> = [
    ['PICKUP_SCHEDULED', 'PICKUP_FAILED'],
    ['PICKUP_FAILED', 'PICKUP_SCHEDULED'],
    ['OUT_FOR_DELIVERY', 'DELIVERY_FAILED'],
    ['DELIVERY_FAILED', 'OUT_FOR_DELIVERY'],
    ['DELIVERY_FAILED', 'RTO_INITIATED'],
    ['RTO_INITIATED', 'RTO_IN_TRANSIT'],
    ['RTO_IN_TRANSIT', 'RTO_DELIVERED'],
  ];

  for (const [from, to] of branchChecks) {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new Error(`Missing branch transition: ${from} -> ${to}`);
    }
  }

  console.log('✓ Phase 5 & 6 OWN-network & branch state machine verified:', ownFlow.join(' -> '));
}

main();

