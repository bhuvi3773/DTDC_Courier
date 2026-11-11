import { ServiceType, PackagingOption, PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { nextAwb } from './awb';
import { getRoutingOptions, QuoteInput } from './carriers/carrier-router';
import { dispatchFulfilment } from './payments';
import { getPricingConfig } from './pricing';
import { recordEvent } from './tracking';
import { ApiError } from './errors';
import { notifyShipmentMilestone } from './notifications';

export interface AddressInput {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
}

export type ShipmentTypeEnum =
  | 'BOOKSTORE_ORDER_SHIPMENT'
  | 'CUSTOMER_OWN_BOOK_SHIPMENT'
  | 'PARTNER_DIRECT_SHIPMENT';

export interface CreateShipmentInput {
  customerId: string;
  optionId: string;
  serviceType: ServiceType;
  packaging: PackagingOption;
  bookCount: number;
  parcelCount: number;
  declaredValue?: number;
  protectionOpted: boolean;
  fromPincode: string;
  toPincode: string;
  dims: { lengthCm: number; widthCm: number; heightCm: number; actualWeightKg: number };
  pickupSlotStart?: string;
  pickupSlotEnd?: string;
  pickupAddress: AddressInput;
  deliveryAddress: AddressInput;
  items?: Array<{ title?: string; isbn?: string; quantity?: number; isFragile?: boolean }>;
  shipmentType?: ShipmentTypeEnum;
  fulfillmentMode?: 'OWN' | 'PARTNER' | 'AUTO';
  paymentMethod?: PaymentMethod;
  promoCode?: string;
  destinationCountry?: string;
  ewayBillNumber?: string;
  prohibitedConfirmed?: boolean;
  solutionCategory?: string;
  goodsDescription?: string;
  specialInstructions?: string;
  businessContractRule?: Record<string, unknown>;
  orderId?: string;
}

/**
 * ShipmentsService.create:
 *   1. Recomputes price server-side (never trusts client price).
 *   2. Separates Own Fleet vs Pre-Existing Partner Carrier modes cleanly.
 *   3. Handles PREPAID (Razorpay), COD (Cash on Delivery), and CORPORATE_CREDIT (B2B).
 *   4. Atomically applies promo usage limits, addresses, parcels, legs, financials, and BOOKED event.
 *   5. Dispatches fulfilment immediately for COD / CORPORATE_CREDIT; waits for confirmPayment for PREPAID.
 */
export async function createShipment(input: CreateShipmentInput) {
  const modeRequested = input.fulfillmentMode;
  const shipmentType: ShipmentTypeEnum =
    input.shipmentType ??
    (modeRequested === 'PARTNER' ? 'PARTNER_DIRECT_SHIPMENT' : 'CUSTOMER_OWN_BOOK_SHIPMENT');

  const ownOnly = shipmentType === 'CUSTOMER_OWN_BOOK_SHIPMENT' && modeRequested !== 'PARTNER';
  const paymentMethod: PaymentMethod = input.paymentMethod ?? 'PREPAID';
  const destCountry = (input.destinationCountry ?? 'IN').trim().toUpperCase();

  if (input.protectionOpted && (!input.declaredValue || input.declaredValue <= 0)) {
    throw ApiError.badRequest(
      'DECLARED_VALUE_REQUIRED',
      'Declared value is required when parcel protection is opted',
    );
  }

  if (paymentMethod === 'COD' && destCountry !== 'IN') {
    throw ApiError.badRequest('COD_DOMESTIC_ONLY', 'Cash on Delivery is only supported for domestic India shipments');
  }

  const effectiveMode: 'OWN' | 'PARTNER' | 'AUTO' | undefined =
    shipmentType === 'PARTNER_DIRECT_SHIPMENT' ? 'PARTNER' : ownOnly ? 'OWN' : modeRequested;

  const quoteInput: QuoteInput = {
    fromPincode: input.fromPincode,
    toPincode: input.toPincode,
    serviceType: input.serviceType,
    packaging: input.packaging,
    dims: input.dims,
    declaredValue: input.declaredValue,
    protectionOpted: input.protectionOpted,
    paymentMethod,
    promoCode: input.promoCode,
    destinationCountry: destCountry,
    ownOnly,
    fulfillmentMode: effectiveMode,
    businessContractRule: input.businessContractRule,
  };
  const options = await getRoutingOptions(quoteInput);
  const chosen = options.find((o) => o.optionId === input.optionId);
  if (!chosen) throw ApiError.badRequest('STALE_QUOTE', 'Selected option is no longer valid; re-quote');

  if (ownOnly && chosen.legPlan.some((leg) => leg.carrierType === 'PARTNER')) {
    throw ApiError.badRequest(
      'OWN_COURIER_ONLY',
      'Own-network booking cannot route to partner carriers; select Partner Network channel instead',
    );
  }

  const pcfg = await getPricingConfig();
  if (paymentMethod === 'COD' && chosen.price > pcfg.codMaxAmount) {
    throw ApiError.badRequest(
      'COD_LIMIT_EXCEEDED',
      `Cash on Delivery max limit is ₹${pcfg.codMaxAmount} per shipment`,
    );
  }

  // Corporate Credit eligibility check
  if (paymentMethod === 'CORPORATE_CREDIT') {
    const cust = await prisma.customer.findUnique({
      where: { id: input.customerId },
      include: { businessAccount: true },
    });
    if (!cust?.businessAccount?.isApproved) {
      throw ApiError.forbidden('Approved Business Account is required for Corporate Credit billing', 'CREDIT_NOT_APPROVED');
    }
    const creditLimit = Number(cust.businessAccount.creditLimit ?? 0);
    if (creditLimit < chosen.price) {
      throw ApiError.unprocessable('Corporate credit limit exceeded for this shipment', 'CREDIT_LIMIT_EXCEEDED');
    }
  }

  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const pickupAddr = await tx.address.create({
      data: { ...input.pickupAddress, customerId: input.customerId, isSaved: false },
    });
    const deliveryAddr = await tx.address.create({
      data: { ...input.deliveryAddress, customerId: input.customerId, isSaved: false },
    });

    const awb = await nextAwb(tx);
    const chargeable = chosen.breakdown?.chargeableWeightKg ?? Math.max(input.dims.actualWeightKg, 0.5);
    const appliedPromo = chosen.breakdown?.appliedPromoCode ?? null;
    const discountAmount = chosen.breakdown?.promoDiscount ?? 0;

    if (appliedPromo) {
      await tx.promoCode.updateMany({
        where: { code: appliedPromo, isActive: true },
        data: { usedCount: { increment: 1 } },
      });
    }

    const initialPaymentStatus = paymentMethod === 'CORPORATE_CREDIT' ? 'CREDIT' : 'PENDING';
    const codAmountVal = paymentMethod === 'COD' ? String(chosen.price) : null;

    const shipment = await tx.shipment.create({
      data: {
        awb,
        customerId: input.customerId,
        pickupAddressId: pickupAddr.id,
        deliveryAddressId: deliveryAddr.id,
        serviceType: input.serviceType,
        shipmentType,
        orderId: input.orderId ?? null,
        packaging: input.packaging,
        bookCount: input.bookCount,
        parcelCount: input.parcelCount,
        declaredValue: input.declaredValue ? String(input.declaredValue) : null,
        protectionOpted: input.protectionOpted,
        paymentMethod,
        paymentStatus: initialPaymentStatus,
        codAmount: codAmountVal,
        promoCode: appliedPromo,
        discountAmount: String(discountAmount),
        destinationCountry: destCountry,
        ewayBillNumber: input.ewayBillNumber?.trim() || null,
        prohibitedConfirmed: Boolean(input.prohibitedConfirmed),
        solutionCategory: input.solutionCategory?.trim() || null,
        goodsDescription: input.goodsDescription?.trim() || null,
        specialInstructions: input.specialInstructions?.trim() || null,
        status: 'BOOKED',
        pickupSlotStart: input.pickupSlotStart ? new Date(input.pickupSlotStart) : null,
        pickupSlotEnd: input.pickupSlotEnd ? new Date(input.pickupSlotEnd) : null,
        estimatedDeliveryAt: new Date(Date.now() + chosen.etaDays * 864e5),
        packages: {
          create: Array.from({ length: input.parcelCount }, (_, i) => ({
            barcode: `${awb}-${i + 1}`,
            actualWeightKg: String(input.dims.actualWeightKg),
            lengthCm: String(input.dims.lengthCm),
            widthCm: String(input.dims.widthCm),
            heightCm: String(input.dims.heightCm),
            chargeableWeightKg: String(chargeable),
          })),
        },
        items: input.items?.length
          ? {
              create: input.items.map((it) => ({
                title: it.title ?? null,
                isbn: it.isbn ?? null,
                quantity: it.quantity ?? 1,
                isFragile: it.isFragile ?? false,
              })),
            }
          : {},
      },
    });

    for (let i = 0; i < chosen.legPlan.length; i++) {
      const leg = chosen.legPlan[i];
      const carrier =
        leg.carrierType === 'OWN' ? null : (await tx.carrier.findUnique({ where: { code: leg.carrierCode } }))?.id ?? null;
      await tx.shipmentLeg.create({
        data: {
          shipmentId: shipment.id,
          sequence: i + 1,
          carrierType: leg.carrierType,
          carrierId: carrier,
          originLabel: chosen.legPlan[0].label,
          destinationLabel: chosen.legPlan[chosen.legPlan.length - 1].label,
        },
      });
    }

    const partnerCost = chosen.legPlan.some((l) => l.carrierType === 'PARTNER') ? Math.round(chosen.price * 0.82 * 100) / 100 : 0;
    await tx.shipmentFinancial.create({
      data: {
        shipmentId: shipment.id,
        customerPrice: String(chosen.price),
        tax: String(chosen.breakdown?.tax ?? 0),
        partnerCost: String(partnerCost),
      },
    });

    await recordEvent(
      {
        shipmentId: shipment.id,
        kind: 'STATUS',
        status: 'BOOKED',
        source: 'SYSTEM',
        remarks:
          paymentMethod === 'COD'
            ? `Booked on Cash on Delivery (COD ₹${chosen.price})`
            : paymentMethod === 'CORPORATE_CREDIT'
            ? 'Booked on Corporate Credit Line'
            : undefined,
        eventTime: new Date(),
      },
      tx,
    );

    await tx.payment.create({
      data: {
        shipmentId: shipment.id,
        provider:
          paymentMethod === 'COD'
            ? 'COD'
            : paymentMethod === 'CORPORATE_CREDIT'
            ? 'CORPORATE_CREDIT'
            : 'RAZORPAY',
        amount: String(chosen.price),
        status: initialPaymentStatus,
      },
    });

    return {
      shipment: await tx.shipment.findUnique({
        where: { id: shipment.id },
        include: { legs: { include: { carrier: { select: { code: true, name: true } } } }, packages: true },
      }),
      paymentOrder: { amount: String(chosen.price), status: initialPaymentStatus, method: paymentMethod },
    };
  });

  // COD & Corporate Credit orders don't wait for Razorpay checkout — dispatch immediately!
  if (created.shipment?.id && (paymentMethod === 'COD' || paymentMethod === 'CORPORATE_CREDIT')) {
    await dispatchFulfilment(created.shipment.id);
    created.shipment = await prisma.shipment.findUnique({
      where: { id: created.shipment.id },
      include: { legs: { include: { carrier: { select: { code: true, name: true } } } }, packages: true },
    });
  }

  if (created.shipment?.id) {
    await notifyShipmentMilestone(created.shipment.id, 'BOOKED');
  }
  return created;
}

export async function cancelShipment(
  shipmentId: string,
  reason?: string,
): Promise<{ shipment: unknown; refunded: number }> {
  const s = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!s) throw ApiError.notFound('Shipment');
  if (!['BOOKED', 'PICKUP_SCHEDULED', 'PICKUP_FAILED'].includes(s.status))
    throw ApiError.unprocessable('Shipment already picked up; cancellation not allowed', 'CANNOT_CANCEL');
  await recordEvent({
    shipmentId,
    kind: 'STATUS',
    status: 'CANCELLED',
    source: 'ADMIN',
    remarks: reason,
    eventTime: new Date(),
  });

  let refunded = 0;
  try {
    const { refundPayment } = await import('./payment/gateway');
    const paid = await prisma.payment.findFirst({
      where: { shipmentId, status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (paid) {
      const fin = await prisma.shipmentFinancial.findUnique({ where: { shipmentId } });
      const refundable = Number(paid.amount) - (fin ? Number(fin.refunded) : 0);
      if (refundable > 0) {
        const r = await refundPayment(shipmentId, refundable, 'auto-refund on pre-pickup cancellation');
        refunded = r.amount;
      }
    }
  } catch (e) {
    console.error(`[cancel] auto-refund failed for shipment ${shipmentId}`, e);
    await prisma.auditLog.create({
      data: {
        action: 'cancel.refund-failed',
        entity: 'Shipment',
        entityId: shipmentId,
        after: { error: String((e as Error).message) },
      },
    });
  }

  return { shipment: await prisma.shipment.findUnique({ where: { id: shipmentId } }), refunded };
}
