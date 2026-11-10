import { PackagingOption, ServiceType, PaymentMethod } from '@prisma/client';
import { prisma } from '../prisma';
import { config } from '../../config';
import {
  quote,
  applyExtrasToPartnerRate,
  getPricingConfig,
  QuoteBreakdown,
  QuoteDimensions,
} from '../pricing';
import { validatePromoCode } from '../promos';
import { carrierRegistry } from './carrier-registry';

export interface QuoteInput {
  fromPincode: string;
  toPincode: string;
  serviceType: ServiceType;
  packaging?: PackagingOption;
  dims: QuoteDimensions;
  declaredValue?: number;
  protectionOpted?: boolean;
  paymentMethod?: PaymentMethod;
  promoCode?: string;
  destinationCountry?: string;
  ownOnly?: boolean;
  fulfillmentMode?: 'OWN' | 'PARTNER' | 'AUTO';
  businessContractRule?: Record<string, unknown>;
}

export interface RoutingLeg {
  carrierType: 'OWN' | 'PARTNER';
  carrierCode: string;
  label: string;
}

export interface RoutingOption {
  optionId: string;
  legPlan: RoutingLeg[];
  carrierCodes: string[];
  price: number;
  etaDays: number;
  carrierTypeLabel: string;
  breakdown?: QuoteBreakdown;
}

export async function currentStrategy(): Promise<'OWN_ONLY' | 'PARTNER_ONLY' | 'AUTO_OPTIMIZED'> {
  const row = await prisma.pricingConfig.findUnique({ where: { key: 'ROUTING_STRATEGY' } });
  if (!row?.value) return config.routingStrategy;
  const val = String(row.value).trim().replace(/^"|"$/g, '');
  if (val === 'OWN_ONLY' || val === 'PARTNER_ONLY' || val === 'AUTO_OPTIMIZED') {
    return val;
  }
  return config.routingStrategy;
}

export async function getRoutingOptions(input: QuoteInput): Promise<RoutingOption[]> {
  const strategy = await currentStrategy();
  const isIntl =
    input.serviceType === 'INTERNATIONAL' ||
    Boolean(input.destinationCountry && input.destinationCountry.toUpperCase() !== 'IN');

  const [fromPincodeRow, toPincodeRow] = await Promise.all([
    prisma.pincode.findUnique({
      where: { pincode: input.fromPincode.trim() },
      include: { city: true },
    }),
    isIntl
      ? Promise.resolve(null)
      : prisma.pincode.findUnique({
          where: { pincode: input.toPincode.trim() },
          include: { city: true },
        }),
  ]);

  const options: RoutingOption[] = [];

  const allowOwn =
    strategy !== 'PARTNER_ONLY' && input.fulfillmentMode !== 'PARTNER';

  const ownServiceableDomestic = Boolean(
    fromPincodeRow &&
      toPincodeRow &&
      fromPincodeRow.city.status === 'ACTIVE' &&
      toPincodeRow.city.status === 'ACTIVE' &&
      fromPincodeRow.ownPickup &&
      toPincodeRow.ownDelivery,
  );

  const ownServiceableIntl = Boolean(
    isIntl &&
      fromPincodeRow &&
      fromPincodeRow.city.status === 'ACTIVE' &&
      fromPincodeRow.ownPickup,
  );

  if (allowOwn && (ownServiceableDomestic || ownServiceableIntl) && fromPincodeRow) {
    try {
      const destZone = isIntl ? 'INTL-GLOBAL' : toPincodeRow!.zone;
      const breakdown = await quote({
        originZone: fromPincodeRow.zone,
        destZone,
        serviceType: input.serviceType,
        packaging: input.packaging,
        dims: input.dims,
        declaredValue: input.declaredValue,
        protectionOpted: input.protectionOpted,
        paymentMethod: input.paymentMethod,
        promoCode: input.promoCode,
        destinationCountry: input.destinationCountry,
        businessContractRule: input.businessContractRule,
      });

      options.push({
        optionId: 'opt-own',
        legPlan: [
          {
            carrierType: 'OWN',
            carrierCode: 'OWN',
            label: isIntl
              ? `Own Fleet Export Consolidation (${(input.destinationCountry || 'US').toUpperCase()})`
              : 'BookCourier Own Network (Verified Doorstep Handover)',
          },
        ],
        carrierCodes: ['OWN'],
        price: breakdown.total,
        etaDays: breakdown.etaDays,
        carrierTypeLabel: 'Own Fleet (Verified Doorstep + 6-Digit OTP)',
        breakdown,
      });
    } catch {
      // Fallback safely if zone configuration invalid
    }
  }

  // Separated Pre-Existing Partner Courier Options:
  // Shown unless global strategy is OWN_ONLY or caller requested ownOnly / OWN channel.
  const allowPartner =
    strategy !== 'OWN_ONLY' &&
    !input.ownOnly &&
    input.fulfillmentMode !== 'OWN';

  if (allowPartner) {
    const [enabledCarriers, pcfg] = await Promise.all([
      prisma.carrier.findMany({ where: { type: 'PARTNER', isEnabled: true } }),
      getPricingConfig(),
    ]);

    for (const carrier of enabledCarriers) {
      try {
        const adapter = carrierRegistry.resolve(carrier.code);
        const s = await adapter.checkServiceability(input.fromPincode, input.toPincode);
        if (!s.serviceable) continue;

        const rate = await adapter.getRate({
          fromPincode: input.fromPincode,
          toPincode: input.toPincode,
          serviceType: input.serviceType,
          dims: input.dims,
        });
        if (!rate) continue;

        // International partner multiplier adjustment when destinationCountry provided
        let adjustedBase = rate.price;
        let etaDays = rate.etaDays;
        if (isIntl && input.destinationCountry && input.destinationCountry !== 'IN') {
          const codeUpper = input.destinationCountry.toUpperCase();
          if (codeUpper === 'AE' || codeUpper === 'SG') {
            adjustedBase *= 0.85;
            etaDays = Math.max(2, etaDays - 1);
          } else if (codeUpper === 'AU' || codeUpper === 'US') {
            adjustedBase *= 1.15;
          }
        }

        let promoDiscount = 0;
        let appliedPromoCode: string | undefined;
        if (input.promoCode) {
          const pr = await validatePromoCode(input.promoCode, adjustedBase);
          if (pr?.valid) {
            promoDiscount = pr.discountAmount;
            appliedPromoCode = pr.code;
          }
        }

        const breakdown = applyExtrasToPartnerRate(
          adjustedBase,
          etaDays,
          input.serviceType,
          input.packaging,
          input.dims,
          pcfg,
          {
            declaredValue: input.declaredValue,
            protectionOpted: input.protectionOpted,
            paymentMethod: input.paymentMethod,
            promoDiscount,
            appliedPromoCode,
            destinationCountry: input.destinationCountry,
            carrierZoneFrom: input.fromPincode,
            carrierZoneTo: isIntl ? (input.destinationCountry || 'US') : input.toPincode,
          },
        );

        options.push({
          optionId: `opt-${carrier.code.toLowerCase()}`,
          legPlan: [
            {
              carrierType: 'PARTNER',
              carrierCode: carrier.code,
              label: `${carrier.name} (Pre-Existing Partner Network)`,
            },
          ],
          carrierCodes: [carrier.code],
          price: breakdown.total,
          etaDays: breakdown.etaDays,
          carrierTypeLabel: `${carrier.name} Partner Service`,
          breakdown,
        });
      } catch {
        // Skip failing partner rate gracefully
      }
    }
  }

  return options.sort((a, b) => a.price - b.price);
}
