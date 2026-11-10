import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

export type NotificationTemplate =
  | 'BOOKED'
  | 'PICKUP_SCHEDULED'
  | 'PICKUP_FAILED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'AT_ORIGIN_HUB'
  | 'AT_DESTINATION_HUB'
  | 'OUT_FOR_DELIVERY_OTP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'RTO_INITIATED'
  | 'RTO_IN_TRANSIT'
  | 'RTO_DELIVERED'
  | 'CANCELLED'
  | 'REFUND_ISSUED'
  | 'TICKET_CREATED'
  | 'TICKET_REPLY'
  | 'TICKET_RESOLVED'
  | 'EXCEPTION_FLAGGED';

export interface DispatchNotificationInput {
  shipmentId?: string | null;
  channel?: 'SMS' | 'EMAIL';
  target: string;
  template: NotificationTemplate | string;
  subject?: string;
  message: string;
  meta?: Record<string, unknown>;
}

/**
 * Send a notification via configured provider (console in dev, HTTP webhook if wired).
 * Retries up to 2 times on transient network failure and persists audit record.
 */
export async function dispatchNotification(input: DispatchNotificationInput) {
  const channel = input.channel ?? 'SMS';
  const record = await prisma.notification.create({
    data: {
      shipmentId: input.shipmentId ?? null,
      channel,
      target: input.target,
      template: input.template,
      status: 'QUEUED',
      payload: {
        subject: input.subject ?? input.template,
        message: input.message,
        ...(input.meta ?? {}),
      } as Prisma.InputJsonValue,
    },
  });

  const providerMode =
    channel === 'EMAIL'
      ? process.env.EMAIL_PROVIDER ?? 'console'
      : process.env.SMS_PROVIDER ?? 'console';
  const webhookUrl =
    channel === 'EMAIL' ? process.env.EMAIL_WEBHOOK_URL : process.env.SMS_WEBHOOK_URL;

  let delivered = false;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (providerMode === 'console' || !webhookUrl) {
        console.log(
          `[NOTIFY:${channel}:${input.template}] to=${input.target} | ${input.message}`,
        );
        delivered = true;
        break;
      }

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: record.id,
          channel,
          target: input.target,
          template: input.template,
          subject: input.subject,
          message: input.message,
        }),
      });
      if (!res.ok) throw new Error(`Provider HTTP ${res.status}`);
      delivered = true;
      break;
    } catch (err) {
      lastError = (err as Error).message;
    }
  }

  return prisma.notification.update({
    where: { id: record.id },
    data: {
      status: delivered ? 'SENT' : 'FAILED',
      payload: {
        subject: input.subject ?? input.template,
        message: input.message,
        ...(input.meta ?? {}),
        ...(lastError && !delivered ? { error: lastError } : {}),
      } as Prisma.InputJsonValue,
    },
  });
}

/**
 * Re-attempt delivery for a FAILED or QUEUED notification record.
 */
export async function retryNotificationById(notificationId: string) {
  const existing = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!existing) return null;

  const payload = (existing.payload ?? {}) as { subject?: string; message?: string };
  const msg = payload.message ?? `Notification ${existing.template}`;
  const webhookUrl =
    existing.channel === 'EMAIL' ? process.env.EMAIL_WEBHOOK_URL : process.env.SMS_WEBHOOK_URL;
  const providerMode =
    existing.channel === 'EMAIL'
      ? process.env.EMAIL_PROVIDER ?? 'console'
      : process.env.SMS_PROVIDER ?? 'console';

  let delivered = false;
  let errorMsg: string | undefined;
  try {
    if (providerMode === 'console' || !webhookUrl) {
      console.log(`[NOTIFY:RETRY:${existing.channel}:${existing.template}] to=${existing.target} | ${msg}`);
      delivered = true;
    } else {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: existing.id,
          channel: existing.channel,
          target: existing.target,
          template: existing.template,
          message: msg,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      delivered = true;
    }
  } catch (err) {
    errorMsg = (err as Error).message;
  }

  return prisma.notification.update({
    where: { id: existing.id },
    data: {
      status: delivered ? 'SENT' : 'FAILED',
      payload: { ...payload, retriedAt: new Date().toISOString(), ...(errorMsg ? { error: errorMsg } : {}) },
    },
  });
}

function formatMilestoneText(awb: string, template: string, extra?: { code?: string; remarks?: string; amount?: number }) {
  switch (template) {
    case 'BOOKED':
      return `BookCourier: Shipment ${awb} booked successfully. Track live updates anytime.`;
    case 'PICKUP_SCHEDULED':
      return `BookCourier: Pickup agent assigned for shipment ${awb}.`;
    case 'PICKED_UP':
      return `BookCourier: Shipment ${awb} has been picked up and is moving to our hub.`;
    case 'AT_ORIGIN_HUB':
      return `BookCourier: Shipment ${awb} arrived at origin sorting hub.`;
    case 'IN_TRANSIT':
      return `BookCourier: Shipment ${awb} is in transit to destination hub.`;
    case 'AT_DESTINATION_HUB':
      return `BookCourier: Shipment ${awb} arrived at destination sorting hub.`;
    case 'OUT_FOR_DELIVERY_OTP':
      return `BookCourier: Shipment ${awb} is out for delivery! Share Delivery OTP ${extra?.code ?? ''} with courier at handover.`;
    case 'OUT_FOR_DELIVERY':
      return `BookCourier: Shipment ${awb} is out for delivery today.`;
    case 'DELIVERED':
      return `BookCourier: Shipment ${awb} delivered successfully. Thank you for choosing BookCourier!`;
    case 'DELIVERY_FAILED':
      return `BookCourier: Delivery attempt failed for ${awb}${extra?.remarks ? ` (${extra.remarks})` : ''}.`;
    case 'PICKUP_FAILED':
      return `BookCourier: Pickup attempt failed for ${awb}${extra?.remarks ? ` (${extra.remarks})` : ''}.`;
    case 'RTO_INITIATED':
      return `BookCourier: Return to Origin (RTO) initiated for ${awb}.`;
    case 'REFUND_ISSUED':
      return `BookCourier: Refund of Rs.${extra?.amount ?? 0} initiated for shipment ${awb}.`;
    case 'EXCEPTION_FLAGGED':
      return `Ops Alert [${awb}]: Flagged tracking event detected — ${extra?.remarks ?? 'Review required'}`;
    default:
      return `BookCourier update for ${awb}: ${template.replace(/_/g, ' ')}`;
  }
}

/**
 * Convenience helper to resolve target recipient/customer for a shipment milestone
 * and dispatch a templated notification safely (never throws into caller flow).
 */
export async function notifyShipmentMilestone(
  shipmentId: string,
  template: NotificationTemplate,
  extra?: { code?: string; remarks?: string; amount?: number },
) {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { customer: { include: { user: { select: { phone: true, email: true } } } } },
    });
    if (!shipment) return;

    let target = shipment.customer?.user?.phone || shipment.customer?.user?.email || 'ops@bookcourier.local';

    if (template === 'OUT_FOR_DELIVERY_OTP' || template === 'OUT_FOR_DELIVERY' || template === 'DELIVERED') {
      const deliveryAddr = await prisma.address.findUnique({ where: { id: shipment.deliveryAddressId } });
      if (deliveryAddr?.phone) target = deliveryAddr.phone;
    } else if (template === 'EXCEPTION_FLAGGED') {
      target = 'ops@bookcourier.local';
    }

    const message = formatMilestoneText(shipment.awb, template, extra);
    await dispatchNotification({
      shipmentId: shipment.id,
      channel: target.includes('@') ? 'EMAIL' : 'SMS',
      target,
      template,
      subject: `BookCourier ${shipment.awb}: ${template.replace(/_/g, ' ')}`,
      message,
      meta: { awb: shipment.awb, ...(extra?.remarks ? { remarks: extra.remarks } : {}) },
    });
  } catch (err) {
    console.error('[notifyShipmentMilestone] non-fatal error:', err);
  }
}

