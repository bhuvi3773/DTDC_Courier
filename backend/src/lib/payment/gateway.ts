import crypto from 'crypto';
import { prisma } from '../prisma';
import { ApiError } from '../errors';
import { notifyShipmentMilestone } from '../notifications';
import { timingSafeEqualHex } from './webhook-verify';

export type GatewayProvider = 'razorpay' | 'mock';

export function activeGateway(): GatewayProvider {
  return process.env.RAZORPAY_KEY_ID ? 'razorpay' : 'mock';
}

function mockSecret(): string {
  return process.env.JWT_ACCESS_SECRET ?? 'mock-payment-secret-32-chars-long';
}

export function computeMockSignature(orderId: string, paymentId: string): string {
  return crypto
    .createHmac('sha256', mockSecret())
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

export interface GatewayOrderResult {
  provider: string;
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  keyId?: string;
  mockVerifyPayload?: {
    orderId: string;
    paymentId: string;
    signature: string;
  };
}

export async function createGatewayOrder(shipmentId: string): Promise<GatewayOrderResult> {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { financial: true, payments: true },
  });
  if (!shipment) throw ApiError.notFound('Shipment');

  const amountNumber = Number(shipment.financial?.customerPrice ?? 0);
  const amountPaise = Math.round(amountNumber * 100);

  const existingPending = shipment.payments.find((p) => p.status === 'PENDING');
  const gatewayName = activeGateway().toUpperCase();

  let providerOrderId = existingPending?.providerOrderId;
  if (!providerOrderId) {
    providerOrderId = `mock_ord_${shipment.awb.slice(-6)}_${Date.now()}`;
    if (existingPending) {
      await prisma.payment.update({
        where: { id: existingPending.id },
        data: { providerOrderId, provider: gatewayName },
      });
    } else {
      await prisma.payment.create({
        data: {
          shipmentId: shipment.id,
          amount: amountNumber,
          provider: gatewayName,
          providerOrderId,
          status: 'PENDING',
        },
      });
    }
  }

  const result: GatewayOrderResult = {
    provider: activeGateway().toUpperCase(),
    providerOrderId,
    amountPaise,
    currency: 'INR',
  };

  if (activeGateway() === 'razorpay') {
    result.keyId = process.env.RAZORPAY_KEY_ID;
  }

  if (activeGateway() === 'mock') {
    const mockPaymentId = `mock_pay_${Date.now()}`;
    result.mockVerifyPayload = {
      orderId: providerOrderId,
      paymentId: mockPaymentId,
      signature: computeMockSignature(providerOrderId, mockPaymentId),
    };
  }

  return result;
}

export function verifyClientPayment(
  _shipmentId: string,
  orderId: string,
  paymentId: string,
  signature: string,
): { valid: boolean; providerPaymentId?: string } {
  const secret =
    activeGateway() === 'mock' ? mockSecret() : (process.env.RAZORPAY_KEY_SECRET ?? '');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  const valid = timingSafeEqualHex(expected, signature);
  return { valid, providerPaymentId: valid ? paymentId : undefined };
}

export async function markPaymentPaid(shipmentId: string, providerPaymentId: string): Promise<boolean> {
  const payment = await prisma.payment.findFirst({
    where: { shipmentId, status: { in: ['PENDING', 'PAID'] } },
    orderBy: { createdAt: 'desc' },
  });

  if (!payment) return false;
  if (payment.status === 'PAID') return true;

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'PAID',
      providerPaymentId,
    },
  });

  await prisma.shipment.update({
    where: { id: shipmentId },
    data: { paymentStatus: 'PAID' },
  });

  return true;
}

export async function refundPayment(
  shipmentId: string,
  amount: number,
  reason: string,
): Promise<{ refunded: boolean; refundId: string; amount: number }> {
  const payment = await prisma.payment.findFirst({
    where: { shipmentId, status: 'PAID' },
    orderBy: { createdAt: 'desc' },
  });

  if (!payment) {
    throw ApiError.badRequest('NO_PAID_PAYMENT', 'No confirmed payment found to refund');
  }

  const existingRefunds = await prisma.refund.findMany({ where: { paymentId: payment.id } });
  const totalRefunded = existingRefunds.reduce((sum, r) => sum + Number(r.amount), 0);
  const remaining = Number(payment.amount) - totalRefunded;

  if (amount > remaining) {
    throw ApiError.unprocessable(
      `Refund amount (₹${amount}) exceeds remaining refundable amount (₹${remaining})`,
      'REFUND_EXCEEDS_PAID',
    );
  }

  const refund = await prisma.refund.create({
    data: {
      paymentId: payment.id,
      amount,
      reason,
      providerRefundId: `mock_ref_${Date.now()}`,
    },
  });

  await prisma.shipmentFinancial.updateMany({
    where: { shipmentId },
    data: { refunded: { increment: amount } },
  });

  await notifyShipmentMilestone(shipmentId, 'REFUND_ISSUED', { amount });

  return { refunded: true, refundId: refund.id, amount };
}
