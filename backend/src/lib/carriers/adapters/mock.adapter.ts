import { ServiceType } from '@prisma/client';
import { prisma } from '../../prisma';
import {
  CarrierAdapter,
  CarrierServiceabilityResult,
  CarrierRate,
  CreateShipmentPayload,
  CreatedPartnerShipment,
  CarrierTrackingEvent,
  QuoteDimensions,
} from '../carrier.interface';

const MOCK_FLOW = [
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_DESTINATION_HUB',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const;

export class MockCarrierAdapter implements CarrierAdapter {
  code = 'MOCK';
  name = 'Mock Courier Simulator';

  async checkServiceability(fromPincode: string, toPincode: string): Promise<CarrierServiceabilityResult> {
    return { serviceable: true, carrierCode: this.code };
  }

  async getRate(payload: {
    fromPincode: string;
    toPincode: string;
    serviceType: ServiceType;
    dims: QuoteDimensions;
  }): Promise<CarrierRate | null> {
    const base = 120;
    const weightFactor = Math.ceil(payload.dims.actualWeightKg) * 40;
    const price = Math.round((base + weightFactor) * 100) / 100;
    return {
      carrierCode: this.code,
      price,
      etaDays: payload.serviceType === 'EXPRESS' ? 2 : 4,
      serviceType: payload.serviceType,
    };
  }

  async createShipment(payload: CreateShipmentPayload): Promise<CreatedPartnerShipment> {
    const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
    const externalAwb = `MOCK-${payload.awb.slice(-6)}-${randomSuffix}-EX`;
    return {
      externalAwb,
      labelUrl: `https://labels.mockcourier.local/${externalAwb}.pdf`,
      cost: 160.0,
    };
  }

  async fetchTracking(externalAwb: string): Promise<CarrierTrackingEvent[]> {
    return [];
  }

  /**
   * Advance simulation hook for dev/testing.
   * Finds the last event recorded for this external AWB and returns the next status in the flow.
   */
  static async advance(externalAwb: string): Promise<{
    status?: string;
    externalEventId?: string;
    eventTime?: Date;
  }> {
    const leg = await prisma.shipmentLeg.findFirst({
      where: { externalAwb },
      include: {
        shipment: {
          include: {
            events: {
              where: { source: 'PARTNER_WEBHOOK' },
              orderBy: { eventTime: 'desc' },
            },
          },
        },
      },
    });

    if (!leg) {
      return { status: undefined };
    }

    const lastEvent = leg.shipment.events[0];
    const lastStatus = lastEvent?.status ?? lastEvent?.rawStatus;

    let nextIndex = 0;
    if (lastStatus) {
      const curIdx = MOCK_FLOW.indexOf(lastStatus as any);
      if (curIdx >= 0 && curIdx < MOCK_FLOW.length - 1) {
        nextIndex = curIdx + 1;
      } else if (curIdx === MOCK_FLOW.length - 1) {
        return { status: undefined }; // Already at terminal DELIVERED
      }
    }

    const nextStatus = MOCK_FLOW[nextIndex];
    const eventTime = new Date();
    const externalEventId = `mock_evt_${externalAwb}_${nextStatus}_${Date.now()}`;

    return {
      status: nextStatus,
      externalEventId,
      eventTime,
    };
  }
}

