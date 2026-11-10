import { ServiceType, PackagingOption, PricingRule, PaymentMethod } from '@prisma/client';
import { prisma } from './prisma';
import { validatePromoCode } from './promos';

/** Pricing formula (section 2.7) — all inputs configurable via PricingConfig & PricingRule. */

export interface QuoteDimensions {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  actualWeightKg: number;
}

export interface QuoteParams {
  originZone: string;
  destZone: string;
  serviceType: ServiceType;
  packaging?: PackagingOption;
  dims: QuoteDimensions;
  declaredValue?: number;
  protectionOpted?: boolean;
  paymentMethod?: PaymentMethod;
  promoCode?: string;
  destinationCountry?: string;
  businessContractRule?: Record<string, unknown>;
}

export interface QuoteBreakdown {
  volumetricWeightKg: number;
  chargeableWeightKg: number;
  base: number;
  pickupFee: number;
  packagingFee: number;
  protectionFee: number;
  codFee: number;
  serviceSurcharge: number;
  contractDiscount: number;
  promoDiscount: number;
  appliedPromoCode?: string;
  promoMessage?: string;
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
  etaDays: number;
  slab: { originZone: string; destZone: string; serviceType: ServiceType; maxWeightKg: number };
}

export interface Pcfg {
  volumetricDivisor: number;
  weightStepKg: number;
  taxRate: number;
  protectionRate: number;
  pickupFee: number;
  packagingFee: number;
  fragilePackagingFee: number;
  tempPackagingFee: number;
  codFee: number;
  codMaxAmount: number;
  serviceSurcharge: number;
}

export async function getPricingConfig(): Promise<Pcfg> {
  const rows = await prisma.pricingConfig.findMany();
  const get = (k: string, d: number) => {
    const r = rows.find((x) => x.key === k);
    const v = r ? Number(r.value) : d;
    return Number.isFinite(v) ? v : d;
  };
  return {
    volumetricDivisor: get('volumetricDivisor', 5000),
    weightStepKg: get('weightStepKg', 0.5),
    taxRate: get('taxRate', 0.18),
    protectionRate: get('protectionRate', 0.01),
    pickupFee: get('pickupFee', 50),
    packagingFee: get('packagingFee', 30),
    fragilePackagingFee: get('fragilePackagingFee', 150),
    tempPackagingFee: get('tempPackagingFee', 220),
    codFee: get('codFee', 40),
    codMaxAmount: get('codMaxAmount', 25000),
    serviceSurcharge: get('serviceSurcharge', 0),
  };
}

export function ceilToStep(x: number, step: number): number {
  if (step <= 0) return x;
  return Math.ceil(x / step - 1e-9) * step;
}

export function volumetricWeightKg(d: QuoteDimensions, divisor: number): number {
  return (d.lengthCm * d.widthCm * d.heightCm) / divisor;
}

export function chargeableWeightKg(d: QuoteDimensions, div: number, step: number): number {
  const vol = volumetricWeightKg(d, div);
  const w = Math.max(d.actualWeightKg, vol);
  return ceilToStep(w, step);
}

/** Find matching active slab for exact (originZone, destZone, serviceType). */
async function findSlab(
  originZone: string,
  destZone: string,
  serviceType: ServiceType,
  weight: number,
): Promise<PricingRule | null> {
  const slab = await prisma.pricingRule.findFirst({
    where: { originZone, destZone, serviceType, isActive: true, maxWeightKg: { gte: weight } },
    orderBy: { maxWeightKg: 'asc' },
  });
  if (slab) return slab;
  return prisma.pricingRule.findFirst({
    where: { originZone, destZone, serviceType, isActive: true },
    orderBy: { maxWeightKg: 'desc' },
  });
}

const INTERNATIONAL_COUNTRY_MULT: Record<string, { mult: number; eta: number }> = {
  US: { mult: 1.35, eta: 5 },
  CA: { mult: 1.4, eta: 5 },
  GB: { mult: 1.25, eta: 4 },
  EU: { mult: 1.3, eta: 5 },
  DE: { mult: 1.3, eta: 5 },
  AE: { mult: 0.9, eta: 3 },
  SG: { mult: 0.95, eta: 3 },
  AU: { mult: 1.45, eta: 6 },
};

const TIER_DERIVATION: Record<ServiceType, { mult: number; eta: number; minBase: number; perKg: number }> = {
  LOCAL: { mult: 1.0, eta: 1, minBase: 79, perKg: 28 },
  INTERCITY: { mult: 1.25, eta: 3, minBase: 179, perKg: 42 },
  EXPRESS: { mult: 1.55, eta: 2, minBase: 199, perKg: 55 },
  EXPRESS_PREMIUM: { mult: 1.85, eta: 1, minBase: 299, perKg: 75 },
  AIRMAX: { mult: 2.2, eta: 1, minBase: 699, perKg: 95 },
  LTL_FREIGHT: { mult: 0.95, eta: 4, minBase: 1250, perKg: 18 },
  FTL_FREIGHT: { mult: 4.5, eta: 3, minBase: 14500, perKg: 6 },
  INTERNATIONAL: { mult: 5.5, eta: 5, minBase: 1190, perKg: 540 },
  HYPERLOCAL: { mult: 1.35, eta: 1, minBase: 129, perKg: 30 },
  SCHEDULED: { mult: 1.1, eta: 2, minBase: 119, perKg: 35 },
  RETURN: { mult: 1.15, eta: 3, minBase: 109, perKg: 35 },
};

export async function quote(p: QuoteParams): Promise<QuoteBreakdown> {
  const c = await getPricingConfig();
  const cw = chargeableWeightKg(p.dims, c.volumetricDivisor, c.weightStepKg);

  let slab: PricingRule | null = await findSlab(p.originZone, p.destZone, p.serviceType, cw);
  let base: number;
  let etaDays: number;
  let slabWeight = Math.max(cw, 1);

  if (slab) {
    base = Number(slab.price);
    etaDays = slab.etaDays;
    slabWeight = Number(slab.maxWeightKg);
    // Scale proportionally if shipment weight significantly exceeds slab weight cap
    if (cw > slabWeight && p.serviceType !== 'FTL_FREIGHT') {
      const extraKg = cw - slabWeight;
      const tier = TIER_DERIVATION[p.serviceType];
      base += extraKg * tier.perKg;
    }
  } else {
    // Derive cleanly from route zone fallback or global tier pricing so every tier always quotes
    const fallbackSameZone = await findSlab(
      p.originZone,
      p.destZone,
      p.originZone === p.destZone ? 'LOCAL' : 'INTERCITY',
      cw,
    );
    const tier = TIER_DERIVATION[p.serviceType];
    const intraCity = p.originZone.split('-')[0] === p.destZone.split('-')[0];
    if (fallbackSameZone) {
      base = Math.max(tier.minBase, Number(fallbackSameZone.price) * tier.mult);
      etaDays = tier.eta;
      slabWeight = Number(fallbackSameZone.maxWeightKg);
    } else {
      const distanceMult = p.serviceType === 'INTERNATIONAL' ? 1 : intraCity ? 0.9 : 1.15;
      base = (tier.minBase + Math.max(0, cw - 1) * tier.perKg) * distanceMult;
      etaDays = tier.eta;
    }
  }

  // Apply International country zone factor when applicable
  if (p.serviceType === 'INTERNATIONAL' || (p.destinationCountry && p.destinationCountry !== 'IN')) {
    const countryKey = (p.destinationCountry || 'US').toUpperCase();
    const countryCfg = INTERNATIONAL_COUNTRY_MULT[countryKey] ?? { mult: 1.5, eta: 6 };
    base = Math.max(990, base) * countryCfg.mult;
    if (cw > 2) base += (cw - 2) * 480 * countryCfg.mult;
    etaDays = countryCfg.eta;
  }

  let contractDiscount = 0;
  if (p.businessContractRule) {
    const r = p.businessContractRule as { slabMultiplier?: number; flatRate?: number };
    const beforeContract = base;
    if (r.flatRate != null) base = r.flatRate;
    if (r.slabMultiplier != null) base *= r.slabMultiplier;
    contractDiscount = Math.max(0, beforeContract - base);
  }

  let packaging = 0;
  if (p.packaging === 'COMPANY_PACKED_FRAGILE') packaging = c.fragilePackagingFee;
  else if (p.packaging === 'COMPANY_PACKED') packaging = c.packagingFee;
  else if (p.packaging === 'TEMPERATURE_CONTROLLED') packaging = c.tempPackagingFee;
  else if (!p.packaging && (p as any).fragile) packaging = c.fragilePackagingFee;

  const protectionFee = p.protectionOpted && p.declaredValue ? p.declaredValue * c.protectionRate : 0;
  const codFee = p.paymentMethod === 'COD' ? c.codFee : 0;

  const grossSubtotal = base + c.pickupFee + packaging + protectionFee + codFee + c.serviceSurcharge;

  // Promo code discount
  let promoDiscount = 0;
  let appliedPromoCode: string | undefined;
  let promoMessage: string | undefined;
  if (p.promoCode) {
    const promo = await validatePromoCode(p.promoCode, grossSubtotal);
    if (promo) {
      if (promo.valid) {
        promoDiscount = promo.discountAmount;
        appliedPromoCode = promo.code;
        promoMessage = promo.description;
      } else {
        promoMessage = promo.reason;
      }
    }
  }

  const subtotal = Math.max(10, grossSubtotal - promoDiscount);
  // International exports are zero-rated GST under LUT; domestic attracts configured GST rate
  const effectiveTaxRate = p.serviceType === 'INTERNATIONAL' || (p.destinationCountry && p.destinationCountry !== 'IN') ? 0 : c.taxRate;
  const tax = subtotal * effectiveTaxRate;
  const total = subtotal + tax;

  return {
    volumetricWeightKg: round3(volumetricWeightKg(p.dims, c.volumetricDivisor)),
    chargeableWeightKg: round3(cw),
    base: round2(base),
    pickupFee: round2(c.pickupFee),
    packagingFee: round2(packaging),
    protectionFee: round2(protectionFee),
    codFee: round2(codFee),
    serviceSurcharge: round2(c.serviceSurcharge),
    contractDiscount: round2(contractDiscount),
    promoDiscount: round2(promoDiscount),
    appliedPromoCode,
    promoMessage,
    subtotal: round2(subtotal),
    taxRate: effectiveTaxRate,
    tax: round2(tax),
    total: round2(total),
    etaDays,
    slab: {
      originZone: p.originZone,
      destZone: p.destZone,
      serviceType: p.serviceType,
      maxWeightKg: slabWeight,
    },
  };
}

export function applyExtrasToPartnerRate(
  baseRatePrice: number,
  etaDays: number,
  serviceType: ServiceType,
  packaging: PackagingOption | undefined,
  dims: QuoteDimensions,
  cfg: Pcfg,
  opts: {
    declaredValue?: number;
    protectionOpted?: boolean;
    paymentMethod?: PaymentMethod;
    promoDiscount?: number;
    appliedPromoCode?: string;
    destinationCountry?: string;
    carrierZoneFrom: string;
    carrierZoneTo: string;
  },
): QuoteBreakdown {
  const cw = chargeableWeightKg(dims, cfg.volumetricDivisor, cfg.weightStepKg);
  let packagingFee = 0;
  if (packaging === 'COMPANY_PACKED_FRAGILE') packagingFee = cfg.fragilePackagingFee;
  else if (packaging === 'COMPANY_PACKED') packagingFee = cfg.packagingFee;
  else if (packaging === 'TEMPERATURE_CONTROLLED') packagingFee = cfg.tempPackagingFee;

  const protectionFee = opts.protectionOpted && opts.declaredValue ? opts.declaredValue * cfg.protectionRate : 0;
  const codFee = opts.paymentMethod === 'COD' ? cfg.codFee : 0;
  const gross = baseRatePrice + packagingFee + protectionFee + codFee;
  const discount = Math.min(opts.promoDiscount ?? 0, Math.max(0, gross - 10));
  const subtotal = Math.max(10, gross - discount);
  const taxRate = serviceType === 'INTERNATIONAL' || (opts.destinationCountry && opts.destinationCountry !== 'IN') ? 0 : cfg.taxRate;
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  return {
    volumetricWeightKg: round3(volumetricWeightKg(dims, cfg.volumetricDivisor)),
    chargeableWeightKg: round3(cw),
    base: round2(baseRatePrice),
    pickupFee: 0,
    packagingFee: round2(packagingFee),
    protectionFee: round2(protectionFee),
    codFee: round2(codFee),
    serviceSurcharge: 0,
    contractDiscount: 0,
    promoDiscount: round2(discount),
    appliedPromoCode: discount > 0 ? opts.appliedPromoCode : undefined,
    subtotal: round2(subtotal),
    taxRate,
    tax: round2(tax),
    total: round2(total),
    etaDays,
    slab: {
      originZone: opts.carrierZoneFrom,
      destZone: opts.carrierZoneTo,
      serviceType,
      maxWeightKg: cw,
    },
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
