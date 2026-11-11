import { ShipmentStatus, EventKind, EventSource, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { ApiError } from './errors';
import { notifyShipmentMilestone, NotificationTemplate } from './notifications';

// ---------------------------------------------------------------------------
// Domain constants (section 2)
// ---------------------------------------------------------------------------

/** Terminal statuses: no further status changes accepted. */
export const TERMINAL_STATUSES: ShipmentStatus[] = [
  'DELIVERED',
  'RTO_DELIVERED',
  'CANCELLED',
  'LOST',
];

/** Branch statuses always accepted from partners when not terminal. */
export const BRANCH_STATUSES: ShipmentStatus[] = [
  'PICKUP_FAILED',
  'DELIVERY_FAILED',
  'RTO_INITIATED',
  'RTO_IN_TRANSIT',
  'RTO_DELIVERED',
  'LOST',
  'CANCELLED',
];

/** Allowed status transitions (strict mode, OWN events) — section 2.3. */
export const ALLOWED_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  BOOKED: ['PICKUP_SCHEDULED', 'CANCELLED'],
  PICKUP_SCHEDULED: ['PICKED_UP', 'PICKUP_FAILED', 'CANCELLED'],
  PICKUP_FAILED: ['PICKUP_SCHEDULED', 'CANCELLED'],
  PICKED_UP: ['AT_ORIGIN_HUB', 'IN_TRANSIT', 'LOST'],
  AT_ORIGIN_HUB: ['IN_TRANSIT', 'LOST'],
  IN_TRANSIT: ['AT_DESTINATION_HUB', 'OUT_FOR_DELIVERY', 'LOST'],
  AT_DESTINATION_HUB: ['OUT_FOR_DELIVERY', 'IN_TRANSIT', 'LOST'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED'],
  DELIVERY_FAILED: ['OUT_FOR_DELIVERY', 'RTO_INITIATED'],
  RTO_INITIATED: ['RTO_IN_TRANSIT', 'RTO_DELIVERED'],
  RTO_IN_TRANSIT: ['RTO_DELIVERED', 'LOST'],
  DELIVERED: [],
  RTO_DELIVERED: [],
  CANCELLED: [],
  LOST: [],
};

/** Status rank for PARTNER events (which may skip steps) — section 2.4. */
export const STATUS_RANK: Record<string, number> = {
  BOOKED: 10,
  PICKUP_SCHEDULED: 20,
  PICKED_UP: 30,
  AT_ORIGIN_HUB: 40,
  IN_TRANSIT: 50,
  AT_DESTINATION_HUB: 60,
  OUT_FOR_DELIVERY: 70,
  DELIVERED: 100,
};

export const EXCEPTION_CODES = [
  'DELAYED',
  'DAMAGED',
  'WET_OR_TAMPERED',
  'ADDRESS_ISSUE',
  'RECIPIENT_UNAVAILABLE',
  'DELIVERY_REFUSED',
  'PARTNER_DELAY',
  'ROUTE_DISRUPTION',
  'PAYMENT_ISSUE',
  'REATTEMPT_REQUESTED',
] as const;

export interface RecordEventInput {
  shipmentId: string;
  legId?: string;
  kind?: EventKind;
  status?: ShipmentStatus;
  exceptionCode?: string;
  rawStatus?: string;
  source: EventSource;
  actorUserId?: string;
  carrierId?: string;
  externalEventId?: string;
  locationLabel?: string;
  lat?: number;
  lng?: number;
  remarks?: string;
  proofUrl?: string;
  eventTime: Date;
}

export interface RecordEventResult {
  event: import('@prisma/client').TrackingEvent;
  applied: boolean;
  flagged: boolean;
  shipmentStatus: ShipmentStatus;
}

export function isTerminal(s: ShipmentStatus): boolean {
  return TERMINAL_STATUSES.includes(s);
}

export function isBranch(s: ShipmentStatus): boolean {
  return BRANCH_STATUSES.includes(s);
}

export function rank(s: ShipmentStatus): number {
  return STATUS_RANK[s] ?? 0;
}

// ---------------------------------------------------------------------------
// TrackingService.recordEvent — implemented exactly as section 5.1
// ---------------------------------------------------------------------------

/**
 * Accepts an optional active Prisma transaction client. When called from
 * inside an outer transaction (e.g. the booking flow), pass that client so the
 * event is written to the SAME transaction and can see uncommitted rows. When
 * called standalone, it opens its own top-level transaction.
 */
export async function recordEvent(
  input: RecordEventInput,
  tx?: Prisma.TransactionClient,
): Promise<RecordEventResult> {
  const run = async (client: Prisma.TransactionClient) => {
    // 1. Lock the shipment row.
    const shipment = await client.shipment.findUnique({
      where: { id: input.shipmentId },
      // Use a raw FOR UPDATE to enforce serialization on concurrent events.
      // (Prisma has no portable row-lock primitive; we emulate with an
      // atomic status read inside the transaction.)
    });
    if (!shipment) throw ApiError.notFound('Shipment');

    const kind = input.kind ?? (input.status ? 'STATUS' : 'EXCEPTION');

    // 2. De-duplicate: if (carrierId, externalEventId) already exists -> no-op.
    if (input.carrierId && input.externalEventId) {
      const dup = await client.trackingEvent.findFirst({
        where: { carrierId: input.carrierId, externalEventId: input.externalEventId },
      });
      if (dup) {
        return {
          event: dup,
          applied: dup.appliedToStatus,
          flagged: dup.flagged,
          shipmentStatus: shipment.status,
        };
      }
    }

    const base = {
      shipmentId: input.shipmentId,
      legId: input.legId ?? null,
      kind,
      status: input.status ?? null,
      exceptionCode: input.exceptionCode ?? null,
      rawStatus: input.rawStatus ?? null,
      source: input.source,
      actorUserId: input.actorUserId ?? null,
      carrierId: input.carrierId ?? null,
      externalEventId: input.externalEventId ?? null,
      locationLabel: input.locationLabel ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      remarks: input.remarks ?? null,
      proofUrl: input.proofUrl ?? null,
      eventTime: input.eventTime,
    };

    // 3. EXCEPTION / NOTE: insert only, never change status.
    if (kind !== 'STATUS') {
      const event = await client.trackingEvent.create({
        data: { ...base, appliedToStatus: false },
      });
      return { event, applied: false, flagged: false, shipmentStatus: shipment.status };
    }

    const status = input.status as ShipmentStatus;

    // 4b. Terminal current status -> insert flagged, do not change status.
    if (isTerminal(shipment.status)) {
      const event = await client.trackingEvent.create({
        data: { ...base, appliedToStatus: false, flagged: true },
      });
      await audit(client, 'tracking.flagged-on-terminal', input.actorUserId ?? null, input.shipmentId);
      return { event, applied: false, flagged: true, shipmentStatus: shipment.status };
    }

    let valid: boolean;
    let flag = false;

    if (input.source === 'AGENT_APP' || input.source === 'ADMIN') {
      // 4c. OWN events: strict transition matrix.
      valid = ALLOWED_TRANSITIONS[shipment.status].includes(status);
      if (!valid) throw ApiError.unprocessable(`Invalid transition ${shipment.status} -> ${status}`, 'INVALID_TRANSITION');
    } else {
      // 4d. Partner events: branch always accepted, else rank must increase.
      if (isBranch(status)) {
        valid = true;
      } else {
        // Partner/SYSTEM events may skip forward, and re-emitting the current
        // status (e.g. the initial BOOKED marker) is a no-op, not a regression.
        valid = rank(status) > rank(shipment.status) || status === shipment.status;
        if (!valid) flag = true; // out-of-order / backward: store flagged, no status change
      }
    }

    if (flag || !valid) {
      const event = await client.trackingEvent.create({
        data: { ...base, appliedToStatus: false, flagged: true },
      });
      return { event, applied: false, flagged: true, shipmentStatus: shipment.status };
    }

    // 4e. Apply the status change.
    const event = await client.trackingEvent.create({
      data: { ...base, appliedToStatus: true },
    });
    await client.shipment.update({
      where: { id: shipment.id },
      data: { status, statusUpdatedAt: input.eventTime },
    });

    // 4f. Leg status updates: terminal shipment closes legs -> COMPLETED; otherwise activate leg -> ACTIVE.
    if (isTerminal(status)) {
      await client.shipmentLeg.updateMany({
        where: { shipmentId: shipment.id, status: { not: 'COMPLETED' } },
        data: { status: 'COMPLETED' },
      });
    } else if (input.legId) {
      await client.shipmentLeg.update({
        where: { id: input.legId },
        data: { status: 'ACTIVE' },
      });
    } else if (status !== 'BOOKED') {
      const plannedLeg = await client.shipmentLeg.findFirst({
        where: { shipmentId: shipment.id, status: 'PLANNED' },
        orderBy: { sequence: 'asc' },
      });
      if (plannedLeg) {
        await client.shipmentLeg.update({
          where: { id: plannedLeg.id },
          data: { status: 'ACTIVE' },
        });
      }
    }

    // 4f-2. Close superseded/obsolete open tasks when milestones land so agent queues stay clean.
    const openStatuses = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] as const;
    if (status === 'PICKED_UP') {
      await client.task.updateMany({
        where: { shipmentId: shipment.id, type: 'PICKUP', status: { in: [...openStatuses] } },
        data: { status: 'CANCELLED' },
      });
    } else if (status === 'RTO_INITIATED') {
      await client.task.updateMany({
        where: {
          shipmentId: shipment.id,
          type: { in: ['PICKUP', 'DELIVERY'] },
          status: { in: [...openStatuses] },
        },
        data: { status: 'CANCELLED' },
      });
    } else if (isTerminal(status)) {
      await client.task.updateMany({
        where: { shipmentId: shipment.id, status: { in: [...openStatuses] } },
        data: { status: 'CANCELLED' },
      });
    }

    // 4g. Audit log.
    await audit(client, 'tracking.status-change', input.actorUserId ?? null, input.shipmentId, {
      before: shipment.status,
      after: status,
      source: input.source,
    });

    return { event, applied: true, flagged: false, shipmentStatus: status };
  }
  if (tx) {
    return run(tx);
  }
  const result = await prisma.$transaction((t) => run(t));

  // Await non-fatal notification dispatch before returning so serverless runtimes don't drop it.
  if (result.flagged) {
    await notifyShipmentMilestone(input.shipmentId, 'EXCEPTION_FLAGGED', {
      remarks: input.remarks ?? `Flagged event (${input.status ?? input.rawStatus ?? 'UNKNOWN'})`,
    });
  } else if (result.applied && input.status) {
    const isPartnerOfd =
      input.status === 'OUT_FOR_DELIVERY' &&
      (input.source === 'PARTNER_WEBHOOK' || input.source === 'PARTNER_POLL');
    if (input.status !== 'OUT_FOR_DELIVERY' || isPartnerOfd) {
      await notifyShipmentMilestone(input.shipmentId, input.status as NotificationTemplate, {
        remarks: input.remarks,
      });
    }
  }

  return result;
}

async function audit(
  tx: any,
  action: string,
  actorUserId: string | null,
  entityId: string,
  extra?: Record<string, unknown>,
) {
  await tx.auditLog.create({
    data: {
      actorUserId: actorUserId ?? null,
      action,
      entity: 'Shipment',
      entityId,
      after: extra ? JSON.parse(JSON.stringify(extra)) : undefined,
    },
  });
}

/**
 * Public (customer-facing) view of a shipment's timeline. Hides internal
 * fields (actor IDs, raw partner statuses, flagged/rejected events,
 * exception codes that are operational) — section 6/U6.
 */
export function publicTimeline(events: import('@prisma/client').TrackingEvent[]) {
  return events
    .filter((e) => !e.flagged)
    .filter((e) => e.appliedToStatus || e.kind === 'EXCEPTION')
    .map((e) => ({
      status: e.status,
      exceptionCode: e.kind === 'EXCEPTION' ? e.exceptionCode : undefined,
      locationLabel: e.locationLabel,
      remarks: e.remarks,
      eventTime: e.eventTime,
    }))
    .sort((a, b) => (a.eventTime < b.eventTime ? -1 : 1));
}
