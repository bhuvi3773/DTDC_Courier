import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ok, handler, ApiError } from '../lib/errors';
import { requireAuth, requireRole } from '../lib/auth';
import { recordEvent, EXCEPTION_CODES } from '../lib/tracking';
import { resolveShipment } from '../lib/operations';
import { notifyShipmentMilestone } from '../lib/notifications';

export const exceptionsRouter = Router();

const EXCEPTION_ROLES = [
  'SUPER_ADMIN',
  'OPS_MANAGER',
  'CITY_MANAGER',
  'HUB_MANAGER',
  'SUPERVISOR',
  'SUPPORT',
] as const;

/** GET /api/exceptions — flagged tracking events, exception logs, and failed/RTO shipments */
exceptionsRouter.get(
  '/',
  requireAuth,
  requireRole(...EXCEPTION_ROLES),
  handler(async (_req, res) => {
    const [flaggedRaw, exceptionRaw, troubledShipments] = await Promise.all([
      prisma.trackingEvent.findMany({
        where: { flagged: true },
        orderBy: { eventTime: 'desc' },
        take: 50,
      }),
      prisma.trackingEvent.findMany({
        where: { kind: 'EXCEPTION' },
        orderBy: { eventTime: 'desc' },
        take: 50,
      }),
      prisma.shipment.findMany({
        where: { status: { in: ['PICKUP_FAILED', 'DELIVERY_FAILED', 'RTO_INITIATED', 'LOST'] } },
        orderBy: { statusUpdatedAt: 'desc' },
        take: 50,
      }),
    ]);

    const shipIds = Array.from(
      new Set([
        ...flaggedRaw.map((e) => e.shipmentId),
        ...exceptionRaw.map((e) => e.shipmentId),
      ]),
    );
    const ships = shipIds.length
      ? await prisma.shipment.findMany({
          where: { id: { in: shipIds } },
          select: { id: true, awb: true, status: true, serviceType: true },
        })
      : [];
    const shipMap = new Map(ships.map((s) => [s.id, s]));

    res.json(
      ok({
        flaggedEvents: flaggedRaw.map((e) => ({ ...e, shipment: shipMap.get(e.shipmentId) ?? null })),
        exceptionEvents: exceptionRaw.map((e) => ({ ...e, shipment: shipMap.get(e.shipmentId) ?? null })),
        troubledShipments,
        exceptionCodes: EXCEPTION_CODES,
      }),
    );
  }),
);

/** POST /api/exceptions/log — staff logs a structured operational exception on a shipment */
const logExceptionSchema = z.object({
  awbOrShipmentId: z.string().min(3),
  exceptionCode: z.string().min(2),
  remarks: z.string().min(3),
  markLost: z.boolean().optional(),
});

exceptionsRouter.post(
  '/log',
  requireAuth,
  requireRole(...EXCEPTION_ROLES),
  handler(async (req, res) => {
    const b = logExceptionSchema.parse(req.body);
    const shipment = await resolveShipment(b.awbOrShipmentId);

    const result = await recordEvent({
      shipmentId: shipment.id,
      kind: b.markLost ? 'STATUS' : 'EXCEPTION',
      status: b.markLost ? 'LOST' : undefined,
      exceptionCode: b.exceptionCode,
      source: 'ADMIN',
      actorUserId: req.auth.userId,
      remarks: b.remarks,
      eventTime: new Date(),
    });

    if (!b.markLost) {
      void notifyShipmentMilestone(shipment.id, 'DELIVERY_FAILED', {
        remarks: `${b.exceptionCode}: ${b.remarks}`,
      });
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'exception.log',
        entity: 'Shipment',
        entityId: shipment.id,
        after: { exceptionCode: b.exceptionCode, remarks: b.remarks, markLost: !!b.markLost },
      },
    });

    res.status(201).json(ok({ event: result.event, awb: shipment.awb, shipmentStatus: result.shipmentStatus }));
  }),
);

/** POST /api/exceptions/events/:eventId/acknowledge — clear a flagged event after Ops review */
exceptionsRouter.post(
  '/events/:eventId/acknowledge',
  requireAuth,
  requireRole(...EXCEPTION_ROLES),
  handler(async (req, res) => {
    const { note } = (req.body ?? {}) as { note?: string };
    const ev = await prisma.trackingEvent.findUnique({ where: { id: req.params.eventId } });
    if (!ev) throw ApiError.notFound('TrackingEvent');

    const updated = await prisma.trackingEvent.update({
      where: { id: ev.id },
      data: { flagged: false, remarks: note ? `${ev.remarks ?? ''} [Ops Reviewed: ${note}]`.trim() : ev.remarks },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'exception.acknowledge',
        entity: 'TrackingEvent',
        entityId: ev.id,
        after: { note: note ?? 'acknowledged' },
      },
    });

    res.json(ok(updated));
  }),
);

