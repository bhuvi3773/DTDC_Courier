import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { publicTimeline, recordEvent, ALLOWED_TRANSITIONS } from '../lib/tracking';
import { assertShipmentReadable, ReqAuth } from '../lib/shipment-access';
import { ok, handler, ApiError } from '../lib/errors';
import { requireAuth, requireRole } from '../lib/auth';

export const trackingRouter = Router();

/**
 * GET /api/track/:awb — PUBLIC, customer-safe timeline. Hides actor ids,
 * raw partner statuses and flagged events.
 */
trackingRouter.get(
  '/track/:awb',
  handler(async (req, res) => {
    const shipment = await prisma.shipment.findUnique({
      where: { awb: req.params.awb },
      include: {
        events: { orderBy: { eventTime: 'asc' } },
        legs: {
          orderBy: { sequence: 'asc' },
          include: { carrier: { select: { code: true, name: true } } },
        },
      },
    });
    if (!shipment) throw ApiError.notFound('Shipment (check your AWB)');
    const [pickup, delivery] = await Promise.all([
      prisma.address.findUnique({ where: { id: shipment.pickupAddressId } }),
      prisma.address.findUnique({ where: { id: shipment.deliveryAddressId } }),
    ]);
    const primaryLeg = shipment.legs[0];
    res.json(
      ok({
        awb: shipment.awb,
        status: shipment.status,
        estimatedDeliveryAt: shipment.estimatedDeliveryAt,
        serviceType: shipment.serviceType,
        shipmentType: shipment.shipmentType,
        destinationCountry: shipment.destinationCountry,
        paymentMethod: shipment.paymentMethod,
        codAmount: shipment.codAmount != null ? Number(shipment.codAmount) : null,
        carrier: primaryLeg
          ? {
              carrierType: primaryLeg.carrierType,
              carrierCode: primaryLeg.carrier?.code ?? 'OWN',
              carrierName: primaryLeg.carrier?.name ?? 'Own Express Network',
              externalAwb: primaryLeg.externalAwb ?? null,
            }
          : null,
        origin: pickup ? { city: pickup.city, pincode: pickup.pincode } : null,
        recipient: delivery
          ? { firstName: delivery.name.split(' ')[0], city: delivery.city, pincode: delivery.pincode }
          : null,
        timeline: publicTimeline(shipment.events),
      }),
    );
  }),
);

/** GET /api/shipments/:id/tracking — ownership-gated full detail. */
trackingRouter.get(
  '/shipments/:id/tracking',
  requireAuth,
  handler(async (req, res) => {
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.id },
      include: { legs: true },
    });
    if (!shipment) throw ApiError.notFound('Shipment');
    await assertShipmentReadable(req.auth as ReqAuth, shipment);
    const events = await prisma.trackingEvent.findMany({
      where: { shipmentId: req.params.id },
      orderBy: { eventTime: 'asc' },
    });
    res.json(ok({ status: shipment.status, legs: shipment.legs, events }));
  }),
);

/**
 * POST /api/admin/shipments/:id/events — manual event (OWN-leg rule from
 * 5.1: admin STATUS updates only when the active leg is OWN).
 */
trackingRouter.post(
  '/admin/shipments/:id/events',
  requireAuth,
  requireRole(
    'SUPER_ADMIN',
    'OPS_MANAGER',
    'CITY_MANAGER',
    'HUB_MANAGER',
    'SUPERVISOR',
    'SUPPORT',
  ),
  handler(async (req, res) => {
    const { kind, status, exceptionCode, remarks, locationLabel } = req.body as {
      kind?: 'STATUS' | 'EXCEPTION' | 'NOTE';
      status?: string;
      exceptionCode?: string;
      remarks?: string;
      locationLabel?: string;
    };
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.id },
      include: { legs: { orderBy: { sequence: 'desc' }, take: 1 } },
    });
    if (!shipment) throw ApiError.notFound('Shipment');
    const activeLeg = shipment.legs[0];

    if (kind === 'STATUS' || status) {
      // Admin STATUS updates only allowed on OWN legs.
      if (activeLeg && activeLeg.carrierType === 'PARTNER')
        throw ApiError.forbidden(
          'Admin cannot post STATUS events to partner legs; use NOTE/EXCEPTION',
          'PARTNER_LEG_NO_STATUS',
        );
      if (status && !ALLOWED_TRANSITIONS[shipment.status].includes(status as never))
        throw ApiError.unprocessable(`Invalid transition ${shipment.status} -> ${status}`, 'INVALID_TRANSITION');
    }

    const result = await recordEvent({
      shipmentId: shipment.id,
      kind: kind ?? 'NOTE',
      status: status as never,
      exceptionCode,
      remarks,
      locationLabel,
      source: 'ADMIN',
      actorUserId: req.auth.userId,
      eventTime: new Date(),
    });

    // Phase 7: an OWN leg going OUT_FOR_DELIVERY gets a delivery OTP issued
    // (idempotent; partner legs and partner-sourced OUT_FOR_DELIVERY don't).
    let deliveryOtp: import('../lib/delivery-otp').IssuedDeliveryOtp | undefined;
    if (status === 'OUT_FOR_DELIVERY' && result.applied && (!activeLeg || activeLeg.carrierType === 'OWN')) {
      const { issueDeliveryOtp } = await import('../lib/delivery-otp');
      deliveryOtp = await issueDeliveryOtp(shipment.id);
    }

    res.json(ok({
      event: result.event,
      applied: result.applied,
      flagged: result.flagged,
      deliveryOtp,
    }));
  }),
);
