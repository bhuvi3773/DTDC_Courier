'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Globe2,
  Layers,
  MapPin,
  Package,
  Send,
  Truck,
  Zap,
} from 'lucide-react';
import {
  getNetworkCoverage,
  quote,
  submitInquiry,
  NetworkCoverageDTO,
  RoutingOption,
} from '@/lib/api';
import { getToken } from '@/lib/auth';
import { COURIER_SERVICES, COURIER_SOLUTIONS } from '@/data/courierCatalog';
import { FadeUp, StaggerCard, StaggerGrid } from '@/components/MotionPrimitives';

const MATRIX_TIERS = [
  { code: 'LOCAL', label: 'Local Standard' },
  { code: 'EXPRESS', label: 'Express Parcel' },
  { code: 'EXPRESS_PREMIUM', label: 'Express Premium (Next-Day)' },
  { code: 'AIRMAX', label: 'AirMax Air Cargo' },
  { code: 'HYPERLOCAL', label: 'Hyperlocal Rapid (Raftaar)' },
  { code: 'LTL_FREIGHT', label: 'LTL / PTL Freight' },
  { code: 'INTERNATIONAL', label: 'International (Global)' },
];

export default function CourierServicesHubPage() {
  const [network, setNetwork] = useState<NetworkCoverageDTO | null>(null);

  // Interactive Multi-Tier Matrix Comparator
  const [fromPin, setFromPin] = useState('560001');
  const [toPin, setToPin] = useState('560038');
  const [country, setCountry] = useState('IN');
  const [weightKg, setWeightKg] = useState(2);
  const [mode, setMode] = useState<'AUTO' | 'OWN' | 'PARTNER'>('AUTO');
  const [comparing, setComparing] = useState(false);
  const [matrixRows, setMatrixRows] = useState<
    Array<{ serviceCode: string; label: string; options: RoutingOption[] }>
  >([]);

  // Enterprise 3PL / FTL / Franchise / ONDC Inquiry State
  const [inqType, setInqType] = useState('3PL_WAREHOUSING');
  const [inqName, setInqName] = useState('');
  const [inqEmail, setInqEmail] = useState('');
  const [inqPhone, setInqPhone] = useState('');
  const [inqCompany, setInqCompany] = useState('');
  const [inqOrigin, setInqOrigin] = useState('Bengaluru');
  const [inqDest, setInqDest] = useState('Mumbai');
  const [inqVolume, setInqVolume] = useState('500+ shipments / month');
  const [inqTemp, setInqTemp] = useState('2°C – 8°C Pharma Cold-Chain');
  const [inqNotes, setInqNotes] = useState('');
  const [inqSubmitting, setInqSubmitting] = useState(false);
  const [inqSuccess, setInqSuccess] = useState<string | null>(null);
  const [inqError, setInqError] = useState<string | null>(null);

  useEffect(() => {
    getNetworkCoverage().then(setNetwork).catch(() => {});
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      const qInq = p.get('inquiry');
      if (qInq) setInqType(qInq);
    }
  }, []);

  const runMatrixCompare = async () => {
    setComparing(true);
    const token = getToken() ?? undefined;
    try {
      const rows = await Promise.all(
        MATRIX_TIERS.map(async (tier) => {
          const isIntl = tier.code === 'INTERNATIONAL';
          const res = await quote(
            {
              fromPincode: fromPin.trim(),
              toPincode: isIntl ? '10001' : toPin.trim(),
              serviceType: tier.code,
              packaging: 'CUSTOMER_PACKED',
              dims: { lengthCm: 30, widthCm: 22, heightCm: 10, actualWeightKg: Math.max(0.5, weightKg) },
              fulfillmentMode: mode,
              ownOnly: mode === 'OWN',
              destinationCountry: isIntl ? (country === 'IN' ? 'US' : country) : 'IN',
            },
            token,
          ).catch(() => ({ options: [] as RoutingOption[] }));
          return { serviceCode: tier.code, label: tier.label, options: res.options };
        }),
      );
      setMatrixRows(rows);
    } finally {
      setComparing(false);
    }
  };

  const handleInquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInqSubmitting(true);
    setInqError(null);
    setInqSuccess(null);
    try {
      const token = getToken() ?? undefined;
      const created = await submitInquiry(
        {
          customerName: inqName,
          email: inqEmail,
          phone: inqPhone,
          companyName: inqCompany || undefined,
          solutionType: inqType,
          originCity: inqOrigin,
          destCity: inqDest,
          monthlyVolume: inqVolume,
          temperatureRange: inqType === 'TEMPERATURE_CONTROLLED' ? inqTemp : undefined,
          notes: inqNotes,
        },
        token,
      );
      setInqSuccess(`Inquiry #${created.id.slice(0, 8)} logged for ${inqType.replace(/_/g, ' ')}! Our solutions team will respond shortly.`);
      setInqNotes('');
    } catch (err: any) {
      setInqError(err?.message || 'Failed to submit inquiry.');
    } finally {
      setInqSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-14">
      {/* Header Banner */}
      <FadeUp className="rounded-3xl bg-slate-950 p-8 sm:p-10 text-white relative overflow-hidden">
        <div className="pointer-events-none absolute -top-20 -right-20 h-72 w-72 rounded-full bg-brand-600/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="max-w-2xl space-y-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/20 border border-brand-400/30 px-3 py-1 text-[11px] font-bold text-brand-300">
              <Truck className="h-3.5 w-3.5" /> Services, Multi-Carrier Rates &amp; 3PL Directory
            </span>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Every Courier &amp; Supply Chain Tier Under One Roof
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Compare live rates across Express Parcel, Express Premium, AirMax, LTL/FTL Freight, Cold-Chain, and 220+ International destinations — or choose Own Fleet vs. Pre-Existing Partners (DTDC, Delhivery, BlueDart).
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/book"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-brand-500 transition"
            >
              <Package className="h-4 w-4" /> Book a Parcel
            </Link>
            <Link
              href="/business"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-5 py-2.5 text-xs font-bold text-white hover:border-slate-500 transition"
            >
              <Building2 className="h-4 w-4" /> B2B CSV &amp; API
            </Link>
          </div>
        </div>
      </FadeUp>

      {/* Interactive Rate & Transit Matrix Calculator */}
      <FadeUp className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
              <Zap className="h-5 w-5 text-brand-600" /> Interactive Multi-Tier Rate &amp; ETA Comparator
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Enter your origin pincode, destination pincode &amp; weight to compare Own Fleet vs. Partner carriers across all 7 service tiers live.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {(['AUTO', 'OWN', 'PARTNER'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-lg px-3 py-1.5 font-semibold border transition ${
                  mode === m
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {m === 'AUTO' ? 'All Carriers' : m === 'OWN' ? 'Own Fleet Only' : 'Partner Carriers Only'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-5 text-xs items-end">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Origin Pincode</label>
            <input
              type="text"
              value={fromPin}
              onChange={(e) => setFromPin(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-semibold"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Destination Pincode</label>
            <input
              type="text"
              value={toPin}
              onChange={(e) => setToPin(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-semibold"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Intl Country (if Intl)</label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 font-semibold"
            >
              <option value="US">United States (US)</option>
              <option value="GB">United Kingdom (GB)</option>
              <option value="AE">UAE (AE)</option>
              <option value="SG">Singapore (SG)</option>
              <option value="DE">Germany / EU (DE)</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Weight (kg)</label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              value={weightKg}
              onChange={(e) => setWeightKg(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-semibold"
            />
          </div>
          <button
            type="button"
            onClick={runMatrixCompare}
            disabled={comparing}
            className="min-h-[38px] rounded-xl bg-brand-600 px-4 py-2 font-bold text-white hover:bg-brand-700 transition disabled:opacity-50"
          >
            {comparing ? 'Calculating...' : 'Compare All Rates'}
          </button>
        </div>

        {matrixRows.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-3">Service Tier</th>
                  <th className="py-2.5 px-3">Available Carriers (Price &bull; ETA)</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {matrixRows.map((row) => (
                  <tr key={row.serviceCode} className="hover:bg-slate-50/70">
                    <td className="py-3 px-3 font-bold text-slate-900">{row.label}</td>
                    <td className="py-3 px-3">
                      {row.options.length === 0 ? (
                        <span className="text-slate-400">Switch channel or try metro corridor (560001 → 560038 / 400001 / 110001)</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {row.options.map((o) => (
                            <span
                              key={o.optionId}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-800"
                            >
                              <span className="font-bold text-brand-700">{o.carrierCodes.join('+')}</span>
                              <span className="font-mono font-bold tabular-nums">₹{o.price.toFixed(0)}</span>
                              <span className="text-[10px] text-slate-400">({o.etaDays}d)</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <Link
                        href={`/book?from=${fromPin}&to=${row.serviceCode === 'INTERNATIONAL' ? '10001' : toPin}&service=${row.serviceCode}&weight=${weightKg}&mode=${mode === 'PARTNER' ? 'PARTNER' : 'OWN'}&country=${row.serviceCode === 'INTERNATIONAL' ? (country === 'IN' ? 'US' : country) : 'IN'}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-brand-600 transition"
                      >
                        Select <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </FadeUp>

      {/* Active Network Map / Coverage Explorer */}
      {network && (
        <FadeUp className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
              <MapPin className="h-5 w-5 text-brand-600" /> Live Serviceable Cities, Hubs &amp; Global Corridors
            </h2>
            <span className="text-xs font-semibold text-brand-700">
              {network.activeCities.length} Active Cities &bull; {network.hubs.length} Sorting Hubs &bull; {network.carriers.length} Carriers
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-3 text-xs">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="font-bold text-slate-900 mb-2">Metro Sorting Hubs</p>
              <ul className="space-y-2">
                {network.hubs.map((h) => (
                  <li key={h.id} className="flex items-start gap-2 text-slate-600">
                    <CheckCircle2 className="h-3.5 w-3.5 text-brand-600 mt-0.5 shrink-0" />
                    <span>
                      <strong className="text-slate-900">{h.name}</strong> ({h.city.name}) — {h.address}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="font-bold text-slate-900 mb-2">Sample Domestic Pincodes</p>
              <div className="flex flex-wrap gap-1.5">
                {network.samplePincodes.map((p) => (
                  <span
                    key={p.pincode}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] font-semibold text-slate-700"
                    title={`${p.city.name} (${p.zone})`}
                  >
                    {p.pincode} &bull; {p.city.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                <Globe2 className="h-3.5 w-3.5 text-brand-600" /> International Corridors
              </p>
              <div className="space-y-1.5">
                {network.internationalDestinations.slice(0, 5).map((d) => (
                  <div key={d.code} className="flex items-center justify-between text-slate-700">
                    <span>{d.name} ({d.code})</span>
                    <span className="font-mono text-[11px] font-bold">From ₹{d.startingPriceInr} ({d.transitDays}d)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </FadeUp>
      )}

      {/* Solutions Cards */}
      <div>
        <h2 className="text-xl font-extrabold text-slate-900 mb-4 flex items-center gap-2">
          <Layers className="h-5 w-5 text-brand-600" /> All Business &amp; Industry Solutions
        </h2>
        <StaggerGrid className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...COURIER_SOLUTIONS, ...COURIER_SERVICES.slice(0, 3)].map((item) => (
            <StaggerCard key={item.slug + item.category} className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
              <span className="text-[10px] font-bold uppercase tracking-wider text-brand-600">{item.category}</span>
              <h3 className="mt-1 font-bold text-slate-900">{item.title}</h3>
              <p className="mt-1 text-xs text-slate-600">{item.description}</p>
              <Link href={item.ctaHref} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-slate-900 hover:text-brand-600">
                {item.ctaLabel} <ArrowRight className="h-3 w-3" />
              </Link>
            </StaggerCard>
          ))}
        </StaggerGrid>
      </div>

      {/* Working Enterprise Inquiry Form (3PL Warehousing, FTL Charter, Cold-Chain, ONDC, Franchise Partner) */}
      <FadeUp id="enterprise-inquiry" className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-card">
        <div className="max-w-2xl">
          <span className="text-xs font-bold uppercase tracking-wider text-brand-600">
            3PL, FTL, Cold-Chain &amp; Partner Franchise
          </span>
          <h2 className="mt-1 text-2xl font-extrabold text-slate-900">
            Request Enterprise Proposal or Partner Onboarding
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Need dedicated 3PL warehousing space, full-truckload charters, pharmaceutical cold-chain routes, or to join as a pickup/franchise partner? Submit directly to our Solutions Ops Queue.
          </p>
        </div>

        {inqSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-semibold text-emerald-800"
          >
            {inqSuccess}
          </motion.div>
        )}
        {inqError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
            {inqError}
          </div>
        )}

        <form onSubmit={handleInquirySubmit} className="mt-6 grid gap-4 sm:grid-cols-2 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Solution Category</label>
            <select
              value={inqType}
              onChange={(e) => setInqType(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold"
            >
              <option value="3PL_WAREHOUSING">3PL Warehousing &amp; Fulfillment</option>
              <option value="FTL_CHARTER">Full Truckload (FTL) Charter</option>
              <option value="TEMPERATURE_CONTROLLED">Temperature Controlled Cold-Chain</option>
              <option value="FRANCHISE_PARTNER">Franchise / Delivery Partner Onboarding</option>
              <option value="ONDC_ECOMMERCE">ONDC &amp; E-Commerce Marketplace Setup</option>
              <option value="B2B_CONTRACT">Enterprise B2B Rate Contract</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Your Name *</label>
            <input
              type="text"
              required
              value={inqName}
              onChange={(e) => setInqName(e.target.value)}
              placeholder="e.g., Arjun Nair"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Work Email *</label>
            <input
              type="email"
              required
              value={inqEmail}
              onChange={(e) => setInqEmail(e.target.value)}
              placeholder="arjun@company.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Phone *</label>
            <input
              type="text"
              required
              value={inqPhone}
              onChange={(e) => setInqPhone(e.target.value)}
              placeholder="9876543210"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Company / Organization</label>
            <input
              type="text"
              value={inqCompany}
              onChange={(e) => setInqCompany(e.target.value)}
              placeholder="Optional company name"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Expected Monthly Volume / Capacity</label>
            <input
              type="text"
              value={inqVolume}
              onChange={(e) => setInqVolume(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Primary Origin City</label>
            <input
              type="text"
              value={inqOrigin}
              onChange={(e) => setInqOrigin(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Destination City / Region</label>
            <input
              type="text"
              value={inqDest}
              onChange={(e) => setInqDest(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>

          {inqType === 'TEMPERATURE_CONTROLLED' && (
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Required Temperature Band</label>
              <input
                type="text"
                value={inqTemp}
                onChange={(e) => setInqTemp(e.target.value)}
                className="w-full rounded-lg border border-sky-300 bg-sky-50/40 px-3 py-2"
              />
            </div>
          )}

          <div className="sm:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">Requirements &amp; Notes *</label>
            <textarea
              required
              rows={3}
              value={inqNotes}
              onChange={(e) => setInqNotes(e.target.value)}
              placeholder="Describe pallet size, storage sq ft, cold-chain payload, or franchise city location..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>

          <div className="sm:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={inqSubmitting}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-slate-900 px-6 py-2.5 text-xs font-bold text-white hover:bg-brand-600 transition disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {inqSubmitting ? 'Submitting Proposal Request...' : 'Submit Inquiry to Operations Desk'}
            </button>
          </div>
        </form>
      </FadeUp>
    </div>
  );
}
