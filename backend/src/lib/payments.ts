import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { carrierRegistry } from './carriers/carrier-registry';
import { CarrierAdapter } from './carriers/carrier.interface';
import { ApiError } from './errors';

/**
 * Shared idempotent fulfilment dispatcher:
 *   1. Allocates external partner leg shipment + AWB (if leg is PARTNER and has no externalAwb yet).
 *   2. Schedules an OWN-fleet PICKUP task (if shipment has any OWN leg and no PICKUP task exists yet).
 *
 * Used by both `confirmPayment` (online PREPAID verification) and COD / Corporate Credit bookings.
 */
export async function dispatchFulfilmentTx(
  tx: Prisma.TransactionClient,
  shipmentId: string,
): Promise<{
  externalAwb?: string;
  partnerLegsCreated: number;
  pickupTaskCreated: boolean;
}> {
  const shipment = await tx.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw ApiError.notFound('Shipment');

  const [pickupAddr, deliveryAddr, legs, pkg] = await Promise.all([
    tx.address.findUnique({ where: { id: shipment.pickupAddressId } }),
    tx.address.findUnique({ where: { id: shipment.deliveryAddressId } }),
    tx.shipmentLeg.findMany({
      where: { shipmentId: shipment.id },
      orderBy: { sequence: 'asc' },
      include: { carrier: true },
    }),
    tx.package.findFirst({ where: { shipmentId: shipment.id } }),
  ]);

  let partnerLegsCreated = 0;
  let externalAwb: string | undefined;

  for (const leg of legs) {
    if (leg.carrierType === 'PARTNER' && !leg.externalAwb) {
      const adapter: CarrierAdapter = carrierRegistry.resolve(leg.carrier?.code ?? 'MOCK');
      const created = await adapter.createShipment({
        awb: shipment.awb,
        fromPincode: pickupAddr?.pincode ?? '000000',
        toPincode: deliveryAddr?.pincode ?? '000000',
        serviceType: shipment.serviceType,
        dims: pkg
          ? {
              lengthCm: Number(pkg.lengthCm),
              widthCm: Number(pkg.widthCm),
              heightCm: Number(pkg.heightCm),
              actualWeightKg: Number(pkg.actualWeightKg),
            }
          : undefined,
      });
      await tx.shipmentLeg.update({
        where: { id: leg.id },
        data: {
          externalAwb: created.externalAwb ?? null,
          labelUrl: created.labelUrl ?? null,
          partnerCost: created.cost != null ? String(created.cost) : leg.partnerCost,
          status: 'ACTIVE',
        },
      });
      if (created.externalAwb) externalAwb = created.externalAwb;
      partnerLegsCreated += 1;
    }
  }

  let pickupTaskCreated = false;
  const hasOwnLeg = legs.some((l) => l.carrierType === 'OWN');
  if (hasOwnLeg) {
    const existingTask = await tx.task.findFirst({
      where: { shipmentId: shipment.id, type: 'PICKUP' },
      select: { id: true },
    });
    if (!existingTask) {
      await tx.task.create({
        data: {
          type: 'PICKUP',
          shipmentId: shipment.id,
          agentId: null,
          status: 'ASSIGNED',
          scheduledFor: shipment.pickupSlotStart ?? undefined,
        },
      });
      pickupTaskCreated = true;
    }
  }

  return { externalAwb, partnerLegsCreated, pickupTaskCreated };
}

export async function dispatchFulfilment(shipmentId: string) {
  return prisma.$transaction((tx) => dispatchFulfilmentTx(tx, shipmentId));
}

export interface ConfirmPaymentResult {
  shipmentId: string;
  awb: string;
  alreadyPaid: boolean;
  externalAwb?: string;
  partnerLegsCreated: number;
  pickupTaskCreated: boolean;
}

export async function confirmPayment(
  shipmentId: string,
  providerPaymentId?: string,
): Promise<ConfirmPaymentResult> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const shipment = await tx.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw ApiError.notFound('Shipment');

    const payment = await tx.payment.findFirst({
      where: { shipmentId, status: { in: ['PENDING', 'PAID', 'CREDIT'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) throw ApiError.notFound('Payment record for shipment');

    let alreadyPaid = payment.status === 'PAID' || payment.status === 'CREDIT';
    if (!alreadyPaid) {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'PAID', providerPaymentId: providerPaymentId ?? payment.providerPaymentId },
      });
      await tx.shipment.update({ where: { id: shipment.id }, data: { paymentStatus: 'PAID' } });
    }

    const dispatched = await dispatchFulfilmentTx(tx, shipment.id);

    return {
      shipmentId: shipment.id,
      awb: shipment.awb,
      alreadyPaid,
      ...dispatched,
    };
  });
}
