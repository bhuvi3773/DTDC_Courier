import { Router, RequestHandler } from 'express';
import { prisma } from '../lib/prisma';
import { confirmPayment } from '../lib/payments';
import {
  createGatewayOrder,
  verifyClientPayment,
  markPaymentPaid,
  refundPayment,
  activeGateway,
} from '../lib/payment/gateway';
import { verifyRazorpayWebhook } from '../lib/payment/webhook-verify';
import { ok, handler, ApiError, fail } from '../lib/errors';
import { requireAuth, requirePermission } from '../lib/auth';
import { assertShipmentReadable, ReqAuth } from '../lib/shipment-access';
import { idempotent } from '../middleware/idempotency';

export const paymentsRouter = Router();

/** Load + ownership-check a shipment for the caller. */
async function ownShipment(req: any, shipmentId: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw ApiError.notFound('Shipment');
  await assertShipmentReadable(req.auth as ReqAuth, shipment);
  return shipment;
}

/** POST /api/payments/:shipmentId/create-order — get a provider order to pay. */
paymentsRouter.post(
  '/:shipmentId/create-order',
  requireAuth,
  idempotent('payments.create-order'),
  handler(async (req, res) => {
    const shipment = await ownShipment(req, req.params.shipmentId);
    const order = await createGatewayOrder(shipment.id);
    res.status(201).json(ok({ ...order, gateway: activeGateway() }));
  }),
);

/**
 * POST /api/payments/:shipmentId/verify — verify the client's payment
 * confirmation, mark PAID, and dispatch fulfilment (idempotent).
 * Body: { orderId, paymentId, signature } (mock) or Razorpay's same shape.
 */
paymentsRouter.post(
  '/:shipmentId/verify',
  requireAuth,
  idempotent('payments.verify'),
  handler(async (req, res) => {
    const { orderId, paymentId, signature } = req.body as {
      orderId: string;
      paymentId: string;
      signature: string;
    };
    const shipment = await ownShipment(req, req.params.shipmentId);
    const verified = verifyClientPayment(shipment.id, orderId, paymentId, signature);
    if (!verified.valid)
      throw ApiError.badRequest('SIGNATURE_INVALID', 'Payment signature verification failed');
    const transitioned = await markPaymentPaid(shipment.id, verified.providerPaymentId ?? paymentId);
    // Dispatch fulfilment exactly once (idempotent inside confirmPayment).
    const result = await confirmPayment(shipment.id, verified.providerPaymentId ?? paymentId);
    res.json(ok({ paid: true, transitioned, ...result }));
  }),
);

/**
 * Low-level dev/test shortcut: mark PAID + dispatch without a gateway round
 * trip. Production clients use create-order → verify above.
 */
paymentsRouter.post(
  '/:shipmentId/confirm',
  requireAuth,
  idempotent('payments.confirm'),
  handler(async (req, res) => {
    const shipment = await ownShipment(req, req.params.shipmentId);
    await markPaymentPaid(
      shipment.id,
      (req.body as { providerPaymentId?: string }).providerPaymentId ?? 'manual',
    );
    const result = await confirmPayment(
      shipment.id,
      (req.body as { providerPaymentId?: string }).providerPaymentId,
    );
    res.json(ok(result));
  }),
);

/** POST /api/payments/:shipmentId/refund — full/partial refund (finance). */
paymentsRouter.post(
  '/:shipmentId/refund',
  requireAuth,
  requirePermission('finance:refund', 'finance:read'),
  handler(async (req, res) => {
    const { amount, reason } = req.body as { amount?: number; reason?: string };
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.shipmentId } });
    if (!shipment) throw ApiError.notFound('Shipment');
    const payment = await prisma.payment.findFirst({
      where: { shipmentId: shipment.id },
      orderBy: { createdAt: 'desc' },
    });
    const result = await refundPayment(
      shipment.id,
      amount ?? Number(payment?.amount ?? 0),
      reason ?? 'admin-initiated refund',
    );
    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'payments.refund',
        entity: 'Shipment',
        entityId: shipment.id,
        after: { refundId: result.refundId, refunded: result.refunded },
      },
    });
    res.json(ok(result));
  }),
);

/** GET /api/payments/shipment/:shipmentId — payment + fulfilment state. */
paymentsRouter.get(
  '/shipment/:shipmentId',
  requireAuth,
  handler(async (req, res) => {
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.shipmentId },
      include: { legs: true },
    });
    if (!shipment) throw ApiError.notFound('Shipment');
    await assertShipmentReadable(req.auth as ReqAuth, shipment);
    const payments = await prisma.payment.findMany({ where: { shipmentId: shipment.id } });
    res.json(ok({
      awb: shipment.awb,
      paymentStatus: shipment.paymentStatus,
      gateway: activeGateway(),
      payments,
      externalAwb: shipment.legs.map((l) => l.externalAwb).filter(Boolean),
    }));
  }),
);

/**
 * POST /api/webhooks/razorpay — provider webhook (raw body, HMAC-SHA512).
 * Mounted with express.raw in server.ts so the signature can be verified over
 * the exact bytes received. Idempotent: safe to process the same event twice.
 */
export const razorpayWebhook: RequestHandler = async (req, res) => {
  const raw = req.body as Buffer;
  const signature = req.header('x-razorpay-signature') ?? '';
  if (!verifyRazorpayWebhook(raw.toString(), signature)) {
    res.status(400).json(fail(400, 'WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature'));
    return;
  }
  try {
    const event = JSON.parse(raw.toString()) as {
      event: string;
      payload?: { payment?: { entity?: { order_id: string; id: string } } };
    };
    const entity = event.payload?.payment?.entity;
    if (event.event === 'payment.captured' && entity?.order_id) {
      // Resolve our payment/shipment from the provider order id.
      const payment = await prisma.payment.findFirst({
        where: { providerOrderId: entity.order_id },
      });
      if (payment) {
        await markPaymentPaid(payment.shipmentId, entity.id);
        await confirmPayment(payment.shipmentId, entity.id);
      }
    }
    // Always acknowledge fast so the provider doesn't retry-storm.
    res.json(ok({ received: true }));
  } catch (e) {
    console.error('[razorpay-webhook] processing error', e);
    res.status(200).json(ok({ received: true, processingError: true }));
  }
};

