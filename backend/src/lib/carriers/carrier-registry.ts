import { CarrierAdapter } from './carrier.interface';
import { MockCarrierAdapter } from './adapters/mock.adapter';
import { PARTNER_ADAPTERS } from './adapters/partner-factory';

class CarrierRegistry {
  private adapters = new Map<string, CarrierAdapter>();

  constructor() {
    this.register(new MockCarrierAdapter());
    for (const adapter of PARTNER_ADAPTERS) {
      this.register(adapter);
    }
  }

  register(adapter: CarrierAdapter) {
    this.adapters.set(adapter.code.toUpperCase(), adapter);
  }

  resolve(code: string): CarrierAdapter {
    const adapter = this.adapters.get(code.toUpperCase());
    if (!adapter) {
      // Fallback to MOCK adapter if requested code is unregistered in dev
      const mock = this.adapters.get('MOCK');
      if (mock) return mock;
      throw new Error(`Carrier adapter for "${code}" not found`);
    }
    return adapter;
  }

  all(): CarrierAdapter[] {
    return Array.from(this.adapters.values());
  }
}

export const carrierRegistry = new CarrierRegistry();

