import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { ApiError } from './errors';
import { recordEvent } from './tracking';
import { notifyShipmentMilestone } from './notifications';

/**
 * Delivery OTP (Phase 7) — recipient-verified last-mile for our OWN fleet.
 *
 * On OUT_FOR_DELIVERY (own delivery), a one-time delivery OTP is issued
 * (console provider in dev logs the code). The recipient (or the agent on
 * their behalf) supplies the code at handover: it is hashed, attempt-capped
 * (3) and expiry-bounded (15 min) per plan §2.5. A valid code records
 * DELIVERED through the SAME tracking engine (own-network strict matrix).
 *
 * Partner legs never issue a delivery OTP — partner delivery is their own
 * last-mile (webhook-driven), so `issueDeliveryOtp` only acts on OWN legs.
 */

export const DELIVERY_OTP_TTL_MS = 15 * 60_000; // 15 min (plan §2.5)
export const DELIVERY_OTP_MAX_ATTEMPTS = 3; // max 3 verification attempts (plan §2.5)
export const DELIVERY_OTP_RESEND_COOLDOWN_MS = 60_000; // 1 minute cooldown between resends

function isDevSms(): boolean {
  return (process.env.SMS_PROVIDER ?? 'console') === 'console';
}

/** Config-driven on/off (PricingConfig key `DELIVERY_OTP_ENABLED`, default on). */
export async function deliveryOtpEnabled(): Promise<boolean> {
  const row = await prisma.pricingConfig.findUnique({ where: { key: 'DELIVERY_OTP_ENABLED' } });
  if (!row) return true;
  const v = row.value;
  return String(v) !== '0' && String(v) !== 'false';
}

/** Bind the hash to the shipment so a code on one AWB can't verify on another. */
function deliveryOtpHash(code: string, shipmentId: string): string {
  return crypto.createHash('sha256').update(`${shipmentId}:${code}`).digest('hex');
}

function deliveryOtpCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export interface IssuedDeliveryOtp {
  issued: boolean;
  reason?: string;
  /**
   * The plaintext code, ONLY in dev (console SMS provider) so the recipient
   * can be told it. Never returned in production — the code goes out via
   * the notification channel (Phase U11), not the API response.
   */
  code?: string;
}

/**
 * Issue the delivery OTP for an OWN shipment. Idempotent: if a live
 * (unconsumed, unexpired) OTP already exists, it is reused rather than
 * reissued. Call this when the shipment goes OUT_FOR_DELIVERY on an OWN leg.
 */
export async function issueDeliveryOtp(shipmentId: string, tx?: Prisma.TransactionClient): Promise<IssuedDeliveryOtp> {
  const db = tx ?? prisma;
  if (!(await deliveryOtpEnabled())) return { issued: false, reason: 'DELIVERY_OTP_DISABLED' };

  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    include: { legs: { orderBy: { sequence: 'asc' } } },
  });
  if (!shipment) return { issued: false, reason: 'SHIPMENT_NOT_FOUND' };

  // Only the OWN last mile verifies a delivery OTP.
  const activeLeg = shipment.legs.find((l) => l.status === 'ACTIVE') ?? shipment.legs[shipment.legs.length - 1];
  if (activeLeg && activeLeg.carrierType === 'PARTNER')
    return { issued: false, reason: 'PARTNER_LEG' };

  // Reuse a live OTP (not consumed, not expired). The plaintext code is only
  // returned the first time it's issued; on reuse it stays internal (the
  // recipient already has it, out-of-band).
  const existing = await db.deliveryOtp.findFirst({
    where: { shipmentId, verifiedAt: null },
    orderBy: { expiresAt: 'desc' },
  });
  if (existing && existing.expiresAt > new Date()) {
    return { issued: true };
  }

  const code = deliveryOtpCode();
  await db.deliveryOtp.create({
    data: {
      shipmentId,
      codeHash: deliveryOtpHash(code, shipmentId),
      expiresAt: new Date(Date.now() + DELIVERY_OTP_TTL_MS),
      attempts: 0,
    },
  });
  if (isDevSms()) {
    console.log(`[OTP:DELIVERY] awb=${shipment.awb} code=${code}`);
  }
  if (!tx) {
    await notifyShipmentMilestone(shipment.id, 'OUT_FOR_DELIVERY_OTP', { code });
  }
  // Dev convenience: hand the code back so the recipient flow can complete.
  return { issued: true, code: isDevSms() ? code : undefined };
}

/**
 * Resend a fresh Delivery OTP (Phase 7 completion).
 * Enforces a 60-second cooldown from the most recent OTP generation.
 * Invalidates any prior active OTPs.
 */
export async function resendDeliveryOtp(shipmentId: string): Promise<IssuedDeliveryOtp> {
  if (!(await deliveryOtpEnabled())) return { issued: false, reason: 'DELIVERY_OTP_DISABLED' };

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { legs: { orderBy: { sequence: 'asc' } } },
  });
  if (!shipment) throw ApiError.notFound('Shipment');

  const activeLeg = shipment.legs.find((l) => l.status === 'ACTIVE') ?? shipment.legs[shipment.legs.length - 1];
  if (activeLeg && activeLeg.carrierType === 'PARTNER') {
    throw ApiError.badRequest('PARTNER_LEG', 'Partner deliveries do not use internal delivery OTPs');
  }

  // Check cooldown on the latest OTP
  const latest = await prisma.deliveryOtp.findFirst({
    where: { shipmentId },
    orderBy: { expiresAt: 'desc' },
  });

  if (latest) {
    const issuedAt = latest.expiresAt.getTime() - DELIVERY_OTP_TTL_MS;
    const elapsed = Date.now() - issuedAt;
    if (elapsed < DELIVERY_OTP_RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((DELIVERY_OTP_RESEND_COOLDOWN_MS - elapsed) / 1000);
      throw ApiError.unprocessable(
        `Please wait ${waitSec} seconds before requesting a new delivery OTP`,
        'DELIVERY_OTP_COOLDOWN',
      );
    }

    // Invalidate previous active OTPs
    await prisma.deliveryOtp.updateMany({
      where: { shipmentId, verifiedAt: null },
      data: { expiresAt: new Date() },
    });
  }

  const code = deliveryOtpCode();
  await prisma.deliveryOtp.create({
    data: {
      shipmentId,
      codeHash: deliveryOtpHash(code, shipmentId),
      expiresAt: new Date(Date.now() + DELIVERY_OTP_TTL_MS),
      attempts: 0,
    },
  });

  if (isDevSms()) {
    console.log(`[OTP:DELIVERY:RESEND] awb=${shipment.awb} code=${code}`);
  }
  await notifyShipmentMilestone(shipment.id, 'OUT_FOR_DELIVERY_OTP', { code });

  return { issued: true, code: isDevSms() ? code : undefined };
}

async function markCodCollectedIfNeeded(shipmentId: string, actorUserId?: string) {
  const s = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (s && s.paymentMethod === 'COD' && !s.codCollected) {
    await prisma.$transaction([
      prisma.shipment.update({
        where: { id: shipmentId },
        data: { codCollected: true, paymentStatus: 'PAID' },
      }),
      prisma.payment.updateMany({
        where: { shipmentId, provider: 'COD', status: 'PENDING' },
        data: { status: 'PAID', providerPaymentId: `cod_col_${actorUserId?.slice(0, 6) ?? 'agent'}_${Date.now()}` },
      }),
    ]);
  }
}

/**
 * Verify the recipient's delivery code. On success, marks the OTP consumed
 * and records DELIVERED through the tracking engine (own strict matrix).
 */
export async function verifyDeliveryOtp(
  shipmentId: string,
  code: string,
  actorUserId?: string,
): Promise<{ delivered: boolean; otpApplied: boolean }> {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw ApiError.notFound('Shipment');

  const otp = await prisma.deliveryOtp.findFirst({
    where: { shipmentId, verifiedAt: null },
    orderBy: { expiresAt: 'desc' },
  });
  if (!otp)
    throw ApiError.unprocessable('No delivery OTP has been issued for this shipment', 'DELIVERY_OTP_NOT_FOUND');
  if (otp.expiresAt < new Date())
    throw ApiError.unprocessable('Delivery OTP expired; a new one will be issued', 'DELIVERY_OTP_EXPIRED');
  if (otp.attempts >= DELIVERY_OTP_MAX_ATTEMPTS)
    throw ApiError.unprocessable('Too many delivery-OTP attempts; code locked', 'DELIVERY_OTP_LOCKED');

  await prisma.deliveryOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
  if (otp.codeHash !== deliveryOtpHash(code, shipmentId))
    throw ApiError.unprocessable('Invalid delivery OTP', 'DELIVERY_OTP_INVALID');

  // Consume it, then record the delivery through the single engine.
  await prisma.deliveryOtp.update({ where: { id: otp.id }, data: { verifiedAt: new Date() } });

  const result = await recordEvent({
    shipmentId,
    kind: 'STATUS',
    status: 'DELIVERED',
    source: 'AGENT_APP', // last-mile handover — the agent confirms the recipient
    actorUserId,
    remarks: 'Delivered — recipient verified delivery OTP',
    eventTime: new Date(),
  });
  if (result.applied) await markCodCollectedIfNeeded(shipmentId, actorUserId);
  return { delivered: result.applied, otpApplied: result.applied };
}

/**
 * Supervisor Exception Bypass (Phase 7 completion).
 * Allows authorized staff / supervisors to record DELIVERED when the recipient
 * cannot provide an OTP (dead phone, SMS gateway disruption, elderly recipient).
 * Requires mandatory reason + audit log entry.
 */
export async function supervisorBypassDeliveryOtp(
  shipmentId: string,
  actorUserId: string,
  reason: string,
  proofUrl?: string,
): Promise<{ delivered: boolean; bypass: boolean }> {
  if (!reason || reason.trim().length < 5) {
    throw ApiError.badRequest('REASON_REQUIRED', 'A detailed reason (min 5 characters) is required for supervisor bypass');
  }

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { legs: { orderBy: { sequence: 'desc' }, take: 1 } },
  });
  if (!shipment) throw ApiError.notFound('Shipment');

  // Invalidate any active OTPs
  await prisma.deliveryOtp.updateMany({
    where: { shipmentId, verifiedAt: null },
    data: { verifiedAt: new Date() },
  });

  // Mandatory Audit Log
  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'delivery.supervisor_bypass',
      entity: 'Shipment',
      entityId: shipment.id,
      after: { reason, proofUrl, bypassedAt: new Date() },
    },
  });

  const result = await recordEvent({
    shipmentId,
    kind: 'STATUS',
    status: 'DELIVERED',
    source: 'ADMIN',
    actorUserId,
    remarks: `Supervisor Delivery Bypass: ${reason}${proofUrl ? ` (Proof: ${proofUrl})` : ''}`,
    eventTime: new Date(),
  });
  if (result.applied) await markCodCollectedIfNeeded(shipmentId, actorUserId);

  return { delivered: result.applied, bypass: true };
}

/**
 * Record a failed delivery attempt and handle re-attempts / automatic RTO (Plan §5.6 step 7).
 * Max 3 delivery re-attempts. After 3 failures -> automatically triggers RTO_INITIATED.
 */
export async function failDeliveryAttempt(
  shipmentId: string,
  actorUserId: string,
  reason: string,
  exceptionCode?: string,
): Promise<{ failed: boolean; rtoInitiated: boolean; attempts: number }> {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw ApiError.notFound('Shipment');

  if (shipment.status !== 'OUT_FOR_DELIVERY') {
    throw ApiError.badRequest(
      'NOT_OUT_FOR_DELIVERY',
      `Cannot fail delivery when shipment is in status ${shipment.status}`,
    );
  }

  // Count prior DELIVERY_FAILED events
  const failureCount = await prisma.trackingEvent.count({
    where: { shipmentId, status: 'DELIVERY_FAILED' },
  });

  const currentAttempt = failureCount + 1;

  // Record DELIVERY_FAILED event
  await recordEvent({
    shipmentId,
    kind: 'STATUS',
    status: 'DELIVERY_FAILED',
    exceptionCode: exceptionCode ?? 'RECIPIENT_UNAVAILABLE',
    source: 'AGENT_APP',
    actorUserId,
    remarks: `Delivery attempt #${currentAttempt} failed: ${reason}`,
    eventTime: new Date(),
  });

  // Check if threshold reached for Return to Origin (max 3 delivery attempts)
  const maxAttempts = 3;
  let rtoInitiated = false;

  if (currentAttempt >= maxAttempts) {
    await recordEvent({
      shipmentId,
      kind: 'STATUS',
      status: 'RTO_INITIATED',
      exceptionCode: 'REATTEMPT_LIMIT_EXCEEDED',
      source: 'SYSTEM',
      remarks: `Maximum delivery attempts (${maxAttempts}) reached; Return to Origin automatically initiated`,
      eventTime: new Date(),
    });
    rtoInitiated = true;
  }

  return { failed: true, rtoInitiated, attempts: currentAttempt };
}
