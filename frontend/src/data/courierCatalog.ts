// Canonical Services & Solutions metadata aligned with DTDC & Delhivery portfolios.
// Every item routes to a working booking flow, bulk portal, or inquiry workflow.

export interface CourierOffering {
  slug: string;
  category: 'SERVICE' | 'SOLUTION';
  title: string;
  tagline: string;
  description: string;
  sla: string;
  serviceType?: string;
  packagingDefault?: string;
  ctaHref: string;
  ctaLabel: string;
  badge?: string;
}

export const COURIER_SERVICES: CourierOffering[] = [
  {
    slug: 'express-parcel',
    category: 'SERVICE',
    title: 'Express Parcel',
    tagline: 'Fast door-to-door parcel delivery with real-time hub scans',
    description: 'Standard & priority domestic movement for documents and personal parcels across metro & regional hubs.',
    sla: '1–3 Days',
    serviceType: 'EXPRESS',
    ctaHref: '/book?service=EXPRESS',
    ctaLabel: 'Ship Express Parcel',
    badge: 'Popular',
  },
  {
    slug: 'express-premium',
    category: 'SERVICE',
    title: 'Express Premium',
    tagline: 'Affordable, time-definite next-day urgent delivery',
    description: 'Day-definite priority routing with dedicated linehaul slot and OTP-verified handover protection.',
    sla: 'Next Day (24 hrs)',
    serviceType: 'EXPRESS_PREMIUM',
    ctaHref: '/book?service=EXPRESS_PREMIUM',
    ctaLabel: 'Book Next-Day',
    badge: 'Assured',
  },
  {
    slug: 'airmax',
    category: 'SERVICE',
    title: 'AirMax Cargo',
    tagline: 'Time-critical, high-volume air express delivery service',
    description: 'Airport-to-door uplifted air cargo for urgent multi-box dispatches, medical supplies, and dense payloads.',
    sla: '24–48 Hours',
    serviceType: 'AIRMAX',
    ctaHref: '/book?service=AIRMAX&weight=15',
    ctaLabel: 'Quote AirMax',
  },
  {
    slug: 'international',
    category: 'SERVICE',
    title: 'International Shipping',
    tagline: 'Global delivery to 220+ destinations with zero-rated export LUT',
    description: 'Doorstep export customs documentation, commercial/personal gift clearance, and global carrier tracking.',
    sla: '3–6 Business Days',
    serviceType: 'INTERNATIONAL',
    ctaHref: '/book?service=INTERNATIONAL&country=US',
    ctaLabel: 'Ship Worldwide',
    badge: '220+ Countries',
  },
  {
    slug: 'ltl-ptl',
    category: 'SERVICE',
    title: 'LTL / PTL Freight',
    tagline: 'Cost-effective part-truckload shipping for heavier loads',
    description: 'Pay only for cubic floor space used across intercity trunk routes for crates, wholesale cartons, and commercial loads.',
    sla: '3–5 Days',
    serviceType: 'LTL_FREIGHT',
    ctaHref: '/book?service=LTL_FREIGHT&weight=50',
    ctaLabel: 'Book LTL Load',
  },
  {
    slug: 'ftl',
    category: 'SERVICE',
    title: 'Full Truckload (FTL)',
    tagline: 'Dedicated vehicle charter from warehouse dock to destination',
    description: 'Exclusive sealed truck dispatch with manifest lock, direct highway routing, and point-to-point scheduling.',
    sla: 'Direct Point-to-Point',
    serviceType: 'FTL_FREIGHT',
    ctaHref: '/book?service=FTL_FREIGHT&weight=500',
    ctaLabel: 'Book FTL Truck',
  },
  {
    slug: '3pl-warehousing',
    category: 'SERVICE',
    title: '3PL & Warehousing',
    tagline: 'End-to-end storage, hub staging, and fulfillment solutions',
    description: 'Multi-city hub storage, barcode inventory receiving, kitting, and same-day dispatch allocation.',
    sla: 'Custom Hub SLA',
    ctaHref: '/courier?inquiry=3PL_WAREHOUSING#enterprise-inquiry',
    ctaLabel: 'Request 3PL Proposal',
  },
  {
    slug: 'hyperlocal-local',
    category: 'SERVICE',
    title: 'Hyperlocal Delivery',
    tagline: 'Same-day rapid intra-city point-to-point dispatch',
    description: 'On-demand rider pickup for urgent intra-city documents, high-value parcels, and doorstep slots.',
    sla: '2–6 Hours',
    serviceType: 'HYPERLOCAL',
    ctaHref: '/book?service=HYPERLOCAL',
    ctaLabel: 'Book Same-Day',
  },
];

export const COURIER_SOLUTIONS: CourierOffering[] = [
  {
    slug: 'personal-courier',
    category: 'SOLUTION',
    title: 'Personal Courier',
    tagline: 'Send documents, luggage, or parcels right from home',
    description: 'Instant pin-to-pin quote, optional waterproof or fragile casing, COD/prepaid payment, and 6-digit OTP verification.',
    sla: 'Doorstep Slot',
    ctaHref: '/book?mode=OWN&service=LOCAL',
    ctaLabel: 'Send Personal Parcel',
    badge: 'Own Network',
  },
  {
    slug: 'partner-carriers',
    category: 'SOLUTION',
    title: 'Pre-Existing Partner Couriers',
    tagline: 'Compare & dispatch via DTDC, Delhivery, or BlueDart directly',
    description: 'Keep third-party partner fulfillment separated from Own Fleet — compare live multi-carrier prices, ETAs, and external AWBs.',
    sla: 'Multi-Carrier',
    ctaHref: '/book?mode=PARTNER&service=EXPRESS',
    ctaLabel: 'Compare Partner Rates',
    badge: '3P Network',
  },
  {
    slug: 'b2b-corporate',
    category: 'SOLUTION',
    title: 'Business-to-Business (B2B)',
    tagline: 'GSTIN accounts, negotiated contracts, credit billing & bulk CSV',
    description: 'Upload 50-row CSV shipment manifests in seconds, unlock contract rate discounts, and pay via Corporate Credit Line.',
    sla: 'Postpaid Credit',
    ctaHref: '/business',
    ctaLabel: 'Open B2B & CSV Portal',
    badge: '12% Contract Off',
  },
  {
    slug: 'temperature-controlled',
    category: 'SOLUTION',
    title: 'Temperature Controlled Logistics',
    tagline: 'Insulated cold-chain packaging for pharma & perishables',
    description: 'Dedicated thermal box packaging with cold-chain handling flags stamped directly on A5 QR shipping labels.',
    sla: '2°C–8°C / Controlled',
    serviceType: 'EXPRESS_PREMIUM',
    packagingDefault: 'TEMPERATURE_CONTROLLED',
    ctaHref: '/book?service=EXPRESS_PREMIUM&packaging=TEMPERATURE_CONTROLLED',
    ctaLabel: 'Book Cold-Chain',
  },
  {
    slug: 'ecommerce-ondc',
    category: 'SOLUTION',
    title: 'E-Commerce & ONDC Integration',
    tagline: 'REST API keys, ONDC BPP webhooks, COD & reverse returns',
    description: 'Generate HMAC-signed API keys, connect Shopify/ONDC stores, test live webhook callbacks, and schedule reverse pickups.',
    sla: 'API + Reverse QC',
    ctaHref: '/business?tab=api',
    ctaLabel: 'Manage API & Webhooks',
  },
  {
    slug: 'raftaar-quick',
    category: 'SOLUTION',
    title: 'Raftaar Rapid & Partner Franchise',
    tagline: 'Quick-commerce hub network & city franchise onboarding',
    description: 'Launch hyperlocal rapid routes or partner with us as a pickup center, hub franchise, or fleet operator.',
    sla: '24/7 Dispatch',
    ctaHref: '/courier?inquiry=FRANCHISE_PARTNER#enterprise-inquiry',
    ctaLabel: 'Become a Partner',
  },
];

