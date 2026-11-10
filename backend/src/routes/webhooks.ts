import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { recordEvent, isBranch } from '../lib/tracking';
import { carrierRegistry } from '../lib/carriers/carrier-registry';
import { ok, handler, ApiError } from '../lib/errors';

export const webhooksRouter = Router();

/**
 * POST /api/webhooks/:carrierCode — inbound partner webhook (U7/U9).
 *   1. Resolve the carrier and log the raw payload (WebhookLog).
 *   2. Map rawStatus via StatusMapping to an internal status or exception.
 *   3. Push the mapped event through TrackingService.recordEvent() with
 *      source=PARTNER_WEBHOOK and a stable externalEventId for dedup.
 */
webhooksRouter.post(
  '/:carrierCode',
  handler(async (req, res) => {
    const code = String(req.params.carrierCode).toUpperCase();
    const body = req.body as {
      externalAwb: string;
      status: string;
      externalEventId?: string;
      locationLabel?: string;
      remarks?: string;
    };
    if (!body.externalAwb || !body.status) {
      throw ApiError.badRequest('MISSING_FIELDS', 'externalAwb and status are required');
    }

    // 1. Log raw payload (always, even if processing later fails).
    await prisma.webhookLog.create({
      data: {
        carrierCode: code,
        body: { externalAwb: body.externalAwb, status: body.status, externalEventId: body.externalEventId ?? null } as never,
        processed: true,
      },
    });

    // 2. Find the active PARTNER leg carrying this external AWB.
    const leg = await prisma.shipmentLeg.findFirst({
      where: { externalAwb: body.externalAwb, carrierType: 'PARTNER' },
      include: { shipment: { select: { id: true, status: true } }, carrier: true },
    });
    if (!leg) {
      res.status(200).json(ok({ accepted: true, ignored: 'no matching leg', code: 200 }));
      return;
    }

    // 3. Map raw status via StatusMapping (fall back to the raw text if the
    //    value happens to be a known internal status).
    const mapping = await prisma.statusMapping.findFirst({
      where: { carrierId: leg.carrierId ?? undefined, rawStatus: body.status },
    });
    const internalStatus =
      mapping?.internalStatus ??
      (Object.keys({ BOOKED: 1, PICKUP_SCHEDULED: 1, PICKED_UP: 1, AT_ORIGIN_HUB: 1, IN_TRANSIT: 1, AT_DESTINATION_HUB: 1, OUT_FOR_DELIVERY: 1, DELIVERY_FAILED: 1, DELIVERED: 1 }) as string[]).includes(
        body.status,
      )
        ? (body.status as import('@prisma/client').ShipmentStatus)
        : undefined;
    const exceptionCode = mapping?.exceptionCode ?? null;

    const externalEventId =
      body.externalEventId ?? `${leg.externalAwb}:${body.status}:${new Date().toISOString()}`;

    // 4. Ingest through the tracking engine (dedup-safe, rank-validated).
    if (internalStatus) {
      await recordEvent({
        shipmentId: leg.shipmentId,
        legId: leg.id,
        kind: 'STATUS',
        status: internalStatus,
        rawStatus: body.status,
        source: 'PARTNER_WEBHOOK',
        carrierId: leg.carrierId ?? undefined,
        externalEventId,
        locationLabel: body.locationLabel,
        remarks: body.remarks,
        eventTime: new Date(),
      });
    } else {
      // Unmapped -> NOTE with rawStatus, flagged for admin mapping queue (U9).
      await recordEvent({
        shipmentId: leg.shipmentId,
        legId: leg.id,
        kind: exceptionCode ? 'EXCEPTION' : 'NOTE',
        exceptionCode: exceptionCode ?? undefined,
        rawStatus: body.status,
        source: 'PARTNER_WEBHOOK',
        carrierId: leg.carrierId ?? undefined,
        externalEventId,
        remarks: body.remarks ?? `Unmapped partner status "${body.status}"`,
        eventTime: new Date(),
      });
    }

    // Respond fast after logging (U9.4).
    res.status(200).json(ok({ accepted: true, leg: leg.id, status: internalStatus ?? 'NOTED' }));
  }),
);

// Dev convenience: advance the MOCK partner, then feed the new status through
// the SAME ingest path a real partner webhook uses, so the timeline updates.
webhooksRouter.post(
  '/dev/:carrierCode/:externalAwb/advance',
  handler(async (req, res) => {
    const { MockCarrierAdapter } = await import('../lib/carriers/adapters/mock.adapter');
    const code = String(req.params.carrierCode).toUpperCase();
    if (code !== 'MOCK') throw ApiError.badRequest('UNSUPPORTED', 'Dev advance available only for MOCK');
    const point = await MockCarrierAdapter.advance(req.params.externalAwb);
    if (!point.status) res.json(ok({ advanced: 'none', externalAwb: req.params.externalAwb }));
    else await ingestPartnerStatus(req.params.externalAwb, point.status, point.externalEventId, code);
    res.json(ok({ advanced: point.status ?? 'none', externalAwb: req.params.externalAwb }));
  }),
);

/** Shared ingest: map a partner raw status and push it through recordEvent. */
async function ingestPartnerStatus(
  externalAwb: string,
  rawStatus: string,
  externalEventId: string | undefined,
  carrierCode: string,
) {
  const leg = await prisma.shipmentLeg.findFirst({
    where: { externalAwb },
    include: { carrier: true },
  });
  if (!leg) return;
  const known = [
    'PICKED_UP',
    'IN_TRANSIT',
    'AT_DESTINATION_HUB',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
  ] as const;
  const internalStatus = (known as readonly string[]).includes(rawStatus)
    ? (rawStatus as import('@prisma/client').ShipmentStatus)
    : undefined;
  const externalEvent = externalEventId ?? `${externalAwb}:${rawStatus}`;
  await recordEvent({
    shipmentId: leg.shipmentId,
    legId: leg.id,
    kind: 'STATUS',
    status: internalStatus,
    rawStatus,
    source: 'PARTNER_WEBHOOK',
    carrierId: leg.carrierId ?? undefined,
    externalEventId: externalEvent,
    remarks: carrierCode === 'MOCK' ? `Simulated ${carrierCode} event` : undefined,
    eventTime: new Date(),
  });
}
