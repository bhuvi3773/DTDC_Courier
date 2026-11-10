import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createShipment, cancelShipment } from '../lib/shipments';
import { assertShipmentReadable, ReqAuth } from '../lib/shipment-access';
import { ok, handler, ApiError } from '../lib/errors';
import { requireAuth, requireRole } from '../lib/auth';
import { idempotent } from '../middleware/idempotency';
import { recordEvent } from '../lib/tracking';
import { SERVICE_TYPE_VALUES, PACKAGING_VALUES, resolveCallerContractRule } from './pricing';

export const shipmentsRouter = Router();

const createSchema = z.object({
  optionId: z.string(),
  shipmentType: z.enum(['CUSTOMER_OWN_BOOK_SHIPMENT', 'PARTNER_DIRECT_SHIPMENT']).optional(),
  fulfillmentMode: z.enum(['OWN', 'PARTNER', 'AUTO']).optional(),
  serviceType: z.enum(SERVICE_TYPE_VALUES),
  packaging: z.enum(PACKAGING_VALUES),
  bookCount: z.number().int().positive().default(1),
  parcelCount: z.number().int().positive().default(1),
  declaredValue: z.number().nonnegative().optional(),
  protectionOpted: z.boolean().default(false),
  paymentMethod: z.enum(['PREPAID', 'COD', 'CORPORATE_CREDIT']).default('PREPAID'),
  promoCode: z.string().optional(),
  destinationCountry: z.string().max(4).default('IN'),
  ewayBillNumber: z.string().optional(),
  prohibitedConfirmed: z.boolean().optional(),
  solutionCategory: z.string().optional(),
  goodsDescription: z.string().optional(),
  specialInstructions: z.string().optional(),
  fromPincode: z.string().min(4),
  toPincode: z.string().min(3),
  dims: z.object({
    lengthCm: z.number().positive(),
    widthCm: z.number().positive(),
    heightCm: z.number().positive(),
    actualWeightKg: z.number().positive(),
  }),
  pickupSlotStart: z.string().datetime().optional(),
  pickupSlotEnd: z.string().datetime().optional(),
  pickupAddress: z.object({
    name: z.string(),
    phone: z.string(),
    line1: z.string(),
    city: z.string(),
    state: z.string(),
    pincode: z.string(),
  }),
  deliveryAddress: z.object({
    name: z.string(),
    phone: z.string(),
    line1: z.string(),
    city: z.string(),
    state: z.string(),
    pincode: z.string(),
  }),
  items: z
    .array(
      z.object({
        title: z.string().optional(),
        isbn: z.string().optional(),
        quantity: z.number().int().positive().default(1),
        isFragile: z.boolean().default(false),
      }),
    )
    .optional(),
});

/** POST /api/shipments — book a shipment (customer or staff), idempotent. */
shipmentsRouter.post(
  '/',
  requireAuth,
  idempotent('shipments.create'),
  handler(async (req, res) => {
    const b = createSchema.parse(req.body);
    const customer = await prisma.customer.findFirst({ where: { userId: req.auth.userId } });
    if (!customer) throw ApiError.badRequest('NO_CUSTOMER_PROFILE', 'No customer profile for this user');

    const resolvedType =
      b.shipmentType ??
      (b.fulfillmentMode === 'PARTNER' ? 'PARTNER_DIRECT_SHIPMENT' : 'CUSTOMER_OWN_BOOK_SHIPMENT');
    const businessContractRule = await resolveCallerContractRule(req.auth.userId);

    const result = await createShipment({
      ...b,
      shipmentType: resolvedType,
      customerId: customer.id,
      businessContractRule,
    });
    res.status(201).json(ok(result));
  }),
);

/** GET /api/shipments — list the caller's shipments (customer-scoped). */
shipmentsRouter.get(
  '/',
  requireAuth,
  handler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const STAFF_READ_ROLES = [
      'SUPER_ADMIN',
      'OPS_MANAGER',
      'CITY_MANAGER',
      'HUB_MANAGER',
      'SUPERVISOR',
      'FINANCE',
      'SUPPORT',
      'ACCOUNT_MANAGER',
    ];
    const isStaff = STAFF_READ_ROLES.includes(req.auth.role);
    const customer = await prisma.customer.findFirst({ where: { userId: req.auth.userId } });
    const where: Prisma.ShipmentWhereInput = isStaff
      ? {}
      : customer
      ? { customerId: customer.id }
      : { customer: { user: { id: req.auth.userId } } };
    if (typeof req.query.shipmentType === 'string' && req.query.shipmentType)
      where.shipmentType = req.query.shipmentType as Prisma.EnumShipmentTypeFilter['equals'];
    if (typeof req.query.status === 'string' && req.query.status)
      where.status = req.query.status as Prisma.EnumShipmentStatusFilter['equals'];
    const [shipments, total] = await Promise.all([
      prisma.shipment.findMany({
        where,
        include: {
          legs: {
            orderBy: { sequence: 'asc' },
            include: { carrier: { select: { code: true, name: true } } },
          },
          financial: { select: { customerPrice: true, tax: true, refunded: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.shipment.count({ where }),
    ]);
    res.json(ok(shipments, { page, pageSize, total }));
  }),
);

/** GET /api/shipments/:id/label — printable A5 PDF label with QR & barcodes (Phase 4). */
shipmentsRouter.get(
  '/:id/label',
  requireAuth,
  handler(async (req, res) => {
    const s = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!s) throw ApiError.notFound('Shipment');
    await assertShipmentReadable(req.auth as ReqAuth, s);
    const { generateShippingLabelPdf } = await import('../lib/label');
    const { buffer, awb } = await generateShippingLabelPdf(s.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="label-${awb}.pdf"`);
    res.send(buffer);
  }),
);

/** GET /api/shipments/:id/invoice — sequential GST Tax Invoice PDF (Phase 9). */
shipmentsRouter.get(
  '/:id/invoice',
  requireAuth,
  handler(async (req, res) => {
    const s = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!s) throw ApiError.notFound('Shipment');
    await assertShipmentReadable(req.auth as ReqAuth, s);
    const { generateInvoicePdf } = await import('../lib/invoice');
    const { buffer, invoiceNumber } = await generateInvoicePdf(s.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoiceNumber}.pdf"`);
    res.send(buffer);
  }),
);

/** GET /api/shipments/:id — ownership-gated (customer/agent see only own). */
shipmentsRouter.get(
  '/:id',
  requireAuth,
  handler(async (req, res) => {
    const s = await prisma.shipment.findUnique({
      where: { id: req.params.id },
      include: { legs: true, packages: true, items: true, financial: true },
    });
    if (!s) throw ApiError.notFound('Shipment');
    await assertShipmentReadable(req.auth as ReqAuth, s);
    res.json(ok(s));
  }),
);

/**
 * POST /api/shipments/:id/verify-delivery-otp — last-mile handover for OWN
 * delivery (Phase 7): supply the delivery code to record DELIVERED.
 * Owner or staff may call it (in prod the agent confirms on the recipient's
 * behalf). Not publicly callable: no unauthenticated AWB+code guessing.
 */
shipmentsRouter.post(
  '/:id/verify-delivery-otp',
  requireAuth,
  handler(async (req, res) => {
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) throw ApiError.notFound('Shipment');
    await assertShipmentReadable(req.auth as ReqAuth, shipment);
    const { code } = (req.body ?? {}) as { code?: string };
    if (!code || !/^\d{6}$/.test(code))
      throw ApiError.badRequest('DELIVERY_OTP_REQUIRED', 'A 6-digit delivery code is required');
    const { verifyDeliveryOtp } = await import('../lib/delivery-otp');
    const r = await verifyDeliveryOtp(shipment.id, code, req.auth.userId);
    res.json(ok({ ...r, awb: shipment.awb, status: 'DELIVERED' }));
  }),
);

/**
 * POST /api/shipments/:id/resend-delivery-otp — request a fresh delivery OTP.
 * Subject to a 60-second cooldown to prevent spam.
 */
shipmentsRouter.post(
  '/:id/resend-delivery-otp',
  requireAuth,
  handler(async (req, res) => {
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) throw ApiError.notFound('Shipment');
    await assertShipmentReadable(req.auth as ReqAuth, shipment);
    const { resendDeliveryOtp } = await import('../lib/delivery-otp');
    const r = await resendDeliveryOtp(shipment.id);
    res.json(ok({ ...r, awb: shipment.awb }));
  }),
);

/**
 * POST /api/shipments/:id/delivery-exception-bypass — supervisor delivery override.
 * When a customer is unable to receive or verify an OTP, authorized supervisors can
 * record DELIVERED with mandatory reason and optional proof. Fully audit-logged.
 */
shipmentsRouter.post(
  '/:id/delivery-exception-bypass',
  requireAuth,
  requireRole('SUPERVISOR', 'HUB_MANAGER', 'OPS_MANAGER', 'SUPER_ADMIN'),
  handler(async (req, res) => {
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) throw ApiError.notFound('Shipment');
    const { reason, proofUrl } = (req.body ?? {}) as { reason?: string; proofUrl?: string };
    if (!reason) {
      throw ApiError.badRequest('REASON_REQUIRED', 'A mandatory reason is required for supervisor delivery bypass');
    }
    const { supervisorBypassDeliveryOtp } = await import('../lib/delivery-otp');
    const r = await supervisorBypassDeliveryOtp(shipment.id, req.auth.userId, reason, proofUrl);
    res.json(ok({ ...r, awb: shipment.awb, status: 'DELIVERED' }));
  }),
);

/**
 * POST /api/shipments/:id/delivery-failed — record a delivery attempt failure.
 * Agent reports recipient unavailable, incorrect OTP, or delivery refused.
 * Automatically initiates RTO after 3 failed attempts.
 */
shipmentsRouter.post(
  '/:id/delivery-failed',
  requireAuth,
  handler(async (req, res) => {
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) throw ApiError.notFound('Shipment');
    await assertShipmentReadable(req.auth as ReqAuth, shipment);
    const { reason, exceptionCode } = (req.body ?? {}) as { reason?: string; exceptionCode?: string };
    const { failDeliveryAttempt } = await import('../lib/delivery-otp');
    const r = await failDeliveryAttempt(
      shipment.id,
      req.auth.userId,
      reason ?? 'Delivery attempt failed',
      exceptionCode,
    );
    res.json(ok({ ...r, awb: shipment.awb }));
  }),
);

/** POST /api/shipments/:id/cancel — only owner or staff; only before pickup. */
shipmentsRouter.post(
  '/:id/cancel',
  requireAuth,
  handler(async (req, res) => {
    const s = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!s) throw ApiError.notFound('Shipment');
    await assertShipmentReadable(req.auth as ReqAuth, s);
    const cancelled = await cancelShipment(req.params.id, (req.body as { reason?: string }).reason);
    res.json(ok(cancelled));
  }),
);

/** POST /api/shipments/:id/ndr-action — customer/staff re-attempt scheduling, address update, or RTO */
const ndrActionSchema = z.object({
  action: z.enum(['RESCHEDULE', 'UPDATE_ADDRESS', 'RTO']),
  rescheduleDate: z.string().optional(),
  newLine1: z.string().min(4).optional(),
  newPhone: z.string().min(5).optional(),
  remarks: z.string().optional(),
});

shipmentsRouter.post(
  '/:id/ndr-action',
  requireAuth,
  handler(async (req, res) => {
    const b = ndrActionSchema.parse(req.body ?? {});
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) throw ApiError.notFound('Shipment');
    await assertShipmentReadable(req.auth as ReqAuth, shipment);

    if (!['DELIVERY_FAILED', 'PICKUP_FAILED', 'OUT_FOR_DELIVERY'].includes(shipment.status)) {
      throw ApiError.unprocessable(
        `NDR actions are only available when shipment is failed or pending re-attempt (current: ${shipment.status})`,
        'NDR_NOT_APPLICABLE',
      );
    }

    const rescheduleDt = b.rescheduleDate ? new Date(b.rescheduleDate) : new Date(Date.now() + 864e5);

    if (b.action === 'UPDATE_ADDRESS' && (b.newLine1 || b.newPhone)) {
      const targetAddrId = shipment.status === 'PICKUP_FAILED' ? shipment.pickupAddressId : shipment.deliveryAddressId;
      await prisma.address.update({
        where: { id: targetAddrId },
        data: {
          ...(b.newLine1 ? { line1: b.newLine1.trim() } : {}),
          ...(b.newPhone ? { phone: b.newPhone.trim() } : {}),
        },
      });
    }

    if (b.action === 'RTO') {
      await recordEvent({
        shipmentId: shipment.id,
        kind: 'STATUS',
        status: 'RTO_INITIATED',
        source: 'ADMIN',
        actorUserId: req.auth.userId,
        remarks: b.remarks ?? 'Customer confirmed Return to Origin',
        eventTime: new Date(),
      });
    } else {
      const taskType = shipment.status === 'PICKUP_FAILED' ? 'PICKUP' : 'DELIVERY';
      await prisma.task.create({
        data: {
          type: taskType,
          shipmentId: shipment.id,
          status: 'ASSIGNED',
          scheduledFor: rescheduleDt,
        },
      });
      await recordEvent({
        shipmentId: shipment.id,
        kind: 'NOTE',
        source: 'ADMIN',
        actorUserId: req.auth.userId,
        remarks: `NDR ${b.action}: ${b.remarks ?? 'Re-attempt requested for ' + rescheduleDt.toISOString().slice(0, 10)}`,
        eventTime: new Date(),
      });
    }

    const updated = await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        ndrAction: b.action,
        ndrRescheduledFor: b.action === 'RTO' ? null : rescheduleDt,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: `shipment.ndr_${b.action.toLowerCase()}`,
        entity: 'Shipment',
        entityId: shipment.id,
        after: b,
      },
    });

    res.json(ok({ shipment: updated, action: b.action }));
  }),
);
