import { ServiceType } from '@prisma/client';
import {
  CarrierAdapter,
  CarrierServiceabilityResult,
  CarrierRate,
  CreateShipmentPayload,
  CreatedPartnerShipment,
  CarrierTrackingEvent,
  QuoteDimensions,
} from '../carrier.interface';

export interface PartnerCarrierProfile {
  code: string;
  name: string;
  awbPrefix: string;
  baseFee: number;
  perKgRate: number;
  baseEtaDays: number;
  supportsInternational?: boolean;
  supportsFreight?: boolean;
  serviceMultipliers?: Partial<Record<ServiceType, { mult: number; etaOverride?: number }>>;
}

const DEFAULT_SERVICE_CONFIG: Record<ServiceType, { mult: number; etaDelta: number }> = {
  LOCAL: { mult: 1.0, etaDelta: -1 },
  INTERCITY: { mult: 1.15, etaDelta: 0 },
  EXPRESS: { mult: 1.45, etaDelta: -1 },
  EXPRESS_PREMIUM: { mult: 1.75, etaDelta: -2 },
  AIRMAX: { mult: 2.1, etaDelta: -1 },
  LTL_FREIGHT: { mult: 0.92, etaDelta: 2 },
  FTL_FREIGHT: { mult: 4.5, etaDelta: 1 },
  INTERNATIONAL: { mult: 5.8, etaDelta: 3 },
  HYPERLOCAL: { mult: 1.25, etaDelta: -2 },
  SCHEDULED: { mult: 1.05, etaDelta: 0 },
  RETURN: { mult: 1.1, etaDelta: 1 },
};

/**
 * Shared parameterized adapter for pre-existing partner courier integrations
 * (DTDC, Delhivery, BlueDart). Keeps rate estimation, AWB allocation, label
 * URLs, and webhook tracking mapping uniform without duplicating adapter logic.
 */
export class PartnerCourierAdapter implements CarrierAdapter {
  code: string;
  name: string;
  private profile: PartnerCarrierProfile;

  constructor(profile: PartnerCarrierProfile) {
    this.profile = profile;
    this.code = profile.code.toUpperCase();
    this.name = profile.name;
  }

  async checkServiceability(fromPincode: string, toPincode: string): Promise<CarrierServiceabilityResult> {
    const cleanFrom = fromPincode.trim();
    const cleanTo = toPincode.trim();
    const valid = /^[0-9A-Za-z-]{4,10}$/.test(cleanFrom) && /^[0-9A-Za-z-]{4,10}$/.test(cleanTo);
    return {
      serviceable: valid,
      carrierCode: this.code,
      ...(valid ? {} : { rejectionReason: 'Invalid postal code format for partner dispatch' }),
    };
  }

  async getRate(payload: {
    fromPincode: string;
    toPincode: string;
    serviceType: ServiceType;
    dims: QuoteDimensions;
  }): Promise<CarrierRate | null> {
    if (payload.serviceType === 'INTERNATIONAL' && !this.profile.supportsInternational) {
      return null;
    }
    if (
      (payload.serviceType === 'LTL_FREIGHT' || payload.serviceType === 'FTL_FREIGHT') &&
      this.profile.supportsFreight === false
    ) {
      return null;
    }

    const volKg = (payload.dims.lengthCm * payload.dims.widthCm * payload.dims.heightCm) / 5000;
    const chgKg = Math.max(0.5, Math.ceil(Math.max(payload.dims.actualWeightKg, volKg) * 2) / 2);

    const isSameZone = payload.fromPincode.slice(0, 3) === payload.toPincode.slice(0, 3);
    const distanceMult = isSameZone ? 0.9 : 1.15;
    const svc = DEFAULT_SERVICE_CONFIG[payload.serviceType] ?? { mult: 1, etaDelta: 0 };
    const override = this.profile.serviceMultipliers?.[payload.serviceType];
    const mult = override?.mult ?? svc.mult;

    const rawPrice = (this.profile.baseFee + chgKg * this.profile.perKgRate) * distanceMult * mult;
    const price = Math.round(rawPrice * 100) / 100;
    const etaDays = Math.max(1, override?.etaOverride ?? this.profile.baseEtaDays + svc.etaDelta);

    return {
      carrierCode: this.code,
      price,
      etaDays,
      serviceType: payload.serviceType,
    };
  }

  async createShipment(payload: CreateShipmentPayload): Promise<CreatedPartnerShipment> {
    const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
    const externalAwb = `${this.profile.awbPrefix}-${payload.awb.slice(-6)}-${rand}`;
    const dims = payload.dims ?? { lengthCm: 25, widthCm: 20, heightCm: 10, actualWeightKg: 1 };
    const rate = await this.getRate({
      fromPincode: payload.fromPincode,
      toPincode: payload.toPincode,
      serviceType: payload.serviceType,
      dims,
    });
    const estCost = rate ? Math.round(rate.price * 0.82 * 100) / 100 : this.profile.baseFee;
    return {
      externalAwb,
      labelUrl: `/api/shipments/${payload.awb}/partner-label?carrier=${this.code}&ext=${externalAwb}`,
      cost: estCost,
    };
  }

  async fetchTracking(_externalAwb: string): Promise<CarrierTrackingEvent[]> {
    return [];
  }
}

export const PARTNER_ADAPTERS: PartnerCourierAdapter[] = [
  new PartnerCourierAdapter({
    code: 'DTDC',
    name: 'DTDC Express & AirMax',
    awbPrefix: 'DTDC',
    baseFee: 95,
    perKgRate: 38,
    baseEtaDays: 3,
    supportsInternational: true,
    supportsFreight: true,
    serviceMultipliers: {
      EXPRESS_PREMIUM: { mult: 1.65, etaOverride: 1 },
      AIRMAX: { mult: 1.95, etaOverride: 1 },
      LTL_FREIGHT: { mult: 0.88, etaOverride: 4 },
      INTERNATIONAL: { mult: 5.4, etaOverride: 5 },
    },
  }),
  new PartnerCourierAdapter({
    code: 'DELHIVERY',
    name: 'Delhivery Direct & PTL',
    awbPrefix: 'DLV',
    baseFee: 89,
    perKgRate: 35,
    baseEtaDays: 3,
    supportsInternational: true,
    supportsFreight: true,
    serviceMultipliers: {
      EXPRESS: { mult: 1.35, etaOverride: 2 },
      LTL_FREIGHT: { mult: 0.85, etaOverride: 4 },
      FTL_FREIGHT: { mult: 4.2, etaOverride: 3 },
      INTERNATIONAL: { mult: 5.75, etaOverride: 6 },
    },
  }),
  new PartnerCourierAdapter({
    code: 'BLUEDART',
    name: 'BlueDart Air Priority',
    awbPrefix: 'BD',
    baseFee: 130,
    perKgRate: 48,
    baseEtaDays: 2,
    supportsInternational: true,
    supportsFreight: false,
    serviceMultipliers: {
      EXPRESS_PREMIUM: { mult: 1.55, etaOverride: 1 },
      AIRMAX: { mult: 1.8, etaOverride: 1 },
      INTERNATIONAL: { mult: 6.1, etaOverride: 4 },
    },
  }),
];
