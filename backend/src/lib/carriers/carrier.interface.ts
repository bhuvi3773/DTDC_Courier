import { ServiceType } from '@prisma/client';

export interface QuoteDimensions {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  actualWeightKg: number;
}

export interface CarrierServiceabilityResult {
  serviceable: boolean;
  carrierCode: string;
  rejectionReason?: string;
}

export interface CarrierRate {
  carrierCode: string;
  price: number;
  etaDays: number;
  serviceType: ServiceType;
}

export interface CreateShipmentPayload {
  awb: string;
  fromPincode: string;
  toPincode: string;
  serviceType: ServiceType;
  dims?: QuoteDimensions;
}

export interface CreatedPartnerShipment {
  externalAwb: string;
  labelUrl?: string;
  cost?: number;
}

export interface CarrierTrackingEvent {
  externalAwb: string;
  status: string;
  externalEventId?: string;
  locationLabel?: string;
  remarks?: string;
  eventTime: Date;
}

export interface CarrierAdapter {
  code: string;
  name: string;
  checkServiceability(fromPincode: string, toPincode: string): Promise<CarrierServiceabilityResult>;
  getRate(payload: {
    fromPincode: string;
    toPincode: string;
    serviceType: ServiceType;
    dims: QuoteDimensions;
  }): Promise<CarrierRate | null>;
  createShipment(payload: CreateShipmentPayload): Promise<CreatedPartnerShipment>;
  fetchTracking(externalAwb: string): Promise<CarrierTrackingEvent[]>;
}

