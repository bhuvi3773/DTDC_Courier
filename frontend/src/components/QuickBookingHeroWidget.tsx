'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  Check,
  Copy,
  Globe2,
  MapPin,
  Package,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Truck,
} from 'lucide-react';
import {
  checkServiceability,
  getActivePromos,
  getNetworkCoverage,
  quote,
  PromoCodeDTO,
  RoutingOption,
  NetworkCoverageDTO,
} from '@/lib/api';
import { getToken } from '@/lib/auth';
import { AnimatedCounter } from './MotionPrimitives';

const PRESET_CORRIDORS = [
  { label: 'BLR 560001 → 560038', from: '560001', to: '560038', service: 'LOCAL' },
  { label: 'BLR → Mumbai (400001)', from: '560001', to: '400001', service: 'EXPRESS_PREMIUM' },
  { label: 'BLR → Delhi AirMax', from: '560001', to: '110001', service: 'AIRMAX' },
  { label: 'BLR → Chennai (Partner)', from: '560001', to: '600001', service: 'INTERCITY' },
];

export function QuickBookingHeroWidget() {
  const router = useRouter();
  const [scope, setScope] = useState<'DOMESTIC' | 'INTERNATIONAL'>('DOMESTIC');
  const [mode, setMode] = useState<'OWN' | 'PARTNER'>('OWN');
  const [fromPincode, setFromPincode] = useState('560001');
  const [toPincode, setToPincode] = useState('560038');
  const [country, setCountry] = useState('US');
  const [serviceType, setServiceType] = useState('LOCAL');
  const [weightKg, setWeightKg] = useState(1.5);
  const [promoCode, setPromoCode] = useState('SHIP25');

  const [promos, setPromos] = useState<PromoCodeDTO[]>([]);
  const [network, setNetwork] = useState<NetworkCoverageDTO | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [trackAwb, setTrackAwb] = useState('');
  const [showMobileAppModal, setShowMobileAppModal] = useState(false);

  const [checking, setChecking] = useState(false);
  const [serviceInfo, setServiceInfo] = useState<string | null>(null);
  const [options, setOptions] = useState<RoutingOption[]>([]);
  const [calcError, setCalcError] = useState<string | null>(null);

  useEffect(() => {
    getActivePromos().then(setPromos).catch(() => {});
    getNetworkCoverage().then(setNetwork).catch(() => {});
  }, []);

  const handleCopyPromo = (code: string) => {
    setPromoCode(code);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(code).catch(() => {});
    }
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleScopeSwitch = (next: 'DOMESTIC' | 'INTERNATIONAL') => {
    setScope(next);
    setOptions([]);
    setCalcError(null);
    setServiceInfo(null);
    if (next === 'INTERNATIONAL') {
      setServiceType('INTERNATIONAL');
      setToPincode('10001');
    } else {
      setServiceType('LOCAL');
      setToPincode('560038');
      setCountry('US');
    }
  };

  const handleEstimate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setChecking(true);
    setCalcError(null);
    setServiceInfo(null);
    setOptions([]);

    try {
      const destCountry = scope === 'INTERNATIONAL' ? country : 'IN';
      const srv = await checkServiceability(fromPincode.trim(), toPincode.trim(), destCountry);
      if (!srv.serviceable) {
        setCalcError(
          'One or both pincodes are currently outside serviceable metro/partner corridors. Try 560001, 560038, 400001, 110001, 500001, or 600001.',
        );
        return;
      }

      const routeDesc = `${srv.from?.city ?? fromPincode} → ${srv.to?.city ?? (scope === 'INTERNATIONAL' ? country : toPincode)}`;
      setServiceInfo(
        `${routeDesc} • ${srv.own ? 'Own Fleet + Partner Available' : 'Partner Express Available'}`,
      );

      const token = getToken() ?? undefined;
      const qRes = await quote(
        {
          fromPincode: fromPincode.trim(),
          toPincode: toPincode.trim(),
          serviceType: scope === 'INTERNATIONAL' ? 'INTERNATIONAL' : serviceType,
          packaging: 'CUSTOMER_PACKED',
          dims: { lengthCm: 25, widthCm: 18, heightCm: 8, actualWeightKg: Math.max(0.2, Number(weightKg) || 1) },
          fulfillmentMode: mode,
          ownOnly: mode === 'OWN',
          destinationCountry: destCountry,
          promoCode: promoCode.trim() || undefined,
        },
        token,
      );

      if (qRes.options.length === 0) {
        setCalcError(
          mode === 'OWN'
            ? 'Own Fleet pickup/delivery is not enabled for this pair — switch to "Partner Carriers" (DTDC / Delhivery / BlueDart) above!'
            : 'No partner carrier option matched this tier.',
        );
      } else {
        setOptions(qRes.options);
      }
    } catch (err: any) {
      setCalcError(err?.message || 'Unable to compute quote right now.');
    } finally {
      setChecking(false);
    }
  };

  const buildBookUrl = (opt?: RoutingOption) => {
    const q = new URLSearchParams({
      from: fromPincode.trim(),
      to: toPincode.trim(),
      weight: String(weightKg),
      mode,
      service: scope === 'INTERNATIONAL' ? 'INTERNATIONAL' : serviceType,
      country: scope === 'INTERNATIONAL' ? country : 'IN',
    });
    if (promoCode.trim()) q.set('promo', promoCode.trim());
    if (opt?.optionId) q.set('optionId', opt.optionId);
    return `/book?${q.toString()}`;
  };

  const featuredPromo = promos[0];

  return (
    <section className="relative overflow-hidden bg-slate-950 text-white">
      {/* Ambient Radial Accents */}
      <div className="pointer-events-none absolute -top-24 -left-24 h-80 w-80 rounded-full bg-brand-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 right-10 h-96 w-96 rounded-full bg-express-600/15 blur-3xl" />

      <div className="relative mx-auto max-w-6xl px-4 py-12 lg:py-16 grid gap-10 lg:grid-cols-12 lg:items-center">
        {/* Left Hero Narrative (7 cols) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
          className="lg:col-span-6 space-y-6"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/80 px-3 py-1 text-[11px] font-semibold text-brand-400">
            <Sparkles className="h-3.5 w-3.5" />
            Own Express Fleet + Multi-Carrier Partner Network
          </div>

          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-5xl leading-[1.12]">
            Send Anything, Anywhere from your{' '}
            <span className="bg-gradient-to-r from-brand-400 to-emerald-300 bg-clip-text text-transparent">
              Doorstep
            </span>
          </h1>

          <p className="max-w-xl text-sm sm:text-base text-slate-300 leading-relaxed">
            Book doorstep parcel pickup, priority Express Premium, heavy AirMax cargo, LTL freight, or Global 220+ country shipping — with instant multi-carrier rate comparison (DTDC, Delhivery, BlueDart, Own Network), COD, and OTP-verified handover.
          </p>

          {/* Featured Promo Coupon Pill (like Delhivery DLV25) */}
          {featuredPromo && (
            <div className="inline-flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-express-500/50 bg-slate-900/90 px-4 py-2.5">
              <span className="text-xs font-semibold text-slate-200">{featuredPromo.description}</span>
              <button
                type="button"
                onClick={() => handleCopyPromo(featuredPromo.code)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-express-600 px-3 py-1 font-mono text-xs font-bold text-white shadow-sm hover:bg-express-500 transition active:scale-95"
              >
                {copiedCode === featuredPromo.code ? (
                  <>
                    <Check className="h-3.5 w-3.5" /> Applied {featuredPromo.code}
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> {featuredPromo.code}
                  </>
                )}
              </button>
            </div>
          )}

          {/* Animated Network Metrics */}
          <div className="grid grid-cols-3 gap-4 border-t border-slate-800 pt-5 max-w-lg">
            <div>
              <p className="text-xl font-extrabold text-white">
                <AnimatedCounter value={network?.activeCities.length ? network.activeCities.length : 5} suffix="+ Hubs" />
              </p>
              <p className="text-[11px] text-slate-400">Active Metro Corridors</p>
            </div>
            <div>
              <p className="text-xl font-extrabold text-brand-400">
                <AnimatedCounter value={220} suffix="+" />
              </p>
              <p className="text-[11px] text-slate-400">Global Destinations</p>
            </div>
            <div>
              <p className="text-xl font-extrabold text-white">
                <AnimatedCounter value={network?.carriers.length ? network.carriers.length : 4} suffix=" Channels" />
              </p>
              <p className="text-[11px] text-slate-400">Own + Partner Carriers</p>
            </div>
          </div>

          {/* Quick Action Buttons + Mobile PWA Access */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href="/business"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:border-brand-400 hover:bg-slate-800 transition"
            >
              <Package className="h-4 w-4 text-brand-400" /> B2B &amp; Bulk CSV Shipping
            </Link>
            <button
              type="button"
              onClick={() => setShowMobileAppModal(true)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:text-white hover:border-slate-700 transition"
            >
              <Smartphone className="h-4 w-4 text-brand-400" /> Field &amp; Customer Mobile View
            </button>
          </div>
        </motion.div>

        {/* Right Interactive Quick Booking & Track Card (6 cols) */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 text-slate-900 shadow-2xl"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="text-lg font-extrabold text-slate-900">
              Send <span className="text-brand-600">Personal Courier</span>
            </h2>
            {/* Scope Toggle: Domestic / International */}
            <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
              {(['DOMESTIC', 'INTERNATIONAL'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => handleScopeSwitch(tab)}
                  className={`relative rounded-lg px-3 py-1.5 transition ${
                    scope === tab ? 'text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {scope === tab && (
                    <motion.span
                      layoutId="heroScopeTab"
                      transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                      className="absolute inset-0 rounded-lg bg-slate-900"
                    />
                  )}
                  <span className="relative z-10 inline-flex items-center gap-1">
                    {tab === 'DOMESTIC' ? <Truck className="h-3 w-3" /> : <Globe2 className="h-3 w-3" />}
                    {tab === 'DOMESTIC' ? 'Domestic' : 'International'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Separated Fulfillment Mode Switcher */}
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setMode('OWN');
                setOptions([]);
              }}
              className={`rounded-lg px-3 py-2 text-left transition ${
                mode === 'OWN'
                  ? 'bg-white text-brand-700 shadow-sm ring-1 ring-brand-500/30 font-bold'
                  : 'text-slate-600 hover:text-slate-900 font-medium'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-brand-600" />
                Own Network Fleet
              </span>
              <span className="block text-[10px] font-normal text-slate-500 mt-0.5">6-digit OTP doorstep handover</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('PARTNER');
                setOptions([]);
              }}
              className={`rounded-lg px-3 py-2 text-left transition ${
                mode === 'PARTNER'
                  ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-indigo-500/30 font-bold'
                  : 'text-slate-600 hover:text-slate-900 font-medium'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5 text-indigo-600" />
                Partner Couriers (3P)
              </span>
              <span className="block text-[10px] font-normal text-slate-500 mt-0.5">DTDC, Delhivery, BlueDart</span>
            </button>
          </div>

          <form onSubmit={handleEstimate} className="space-y-3 text-xs">
            {/* Corridor Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Pickup Pin Code</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={fromPincode}
                    onChange={(e) => setFromPincode(e.target.value)}
                    placeholder="e.g., 560001"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 font-mono font-semibold text-slate-900 focus:border-brand-600 focus:outline-none"
                  />
                </div>
              </div>

              {scope === 'DOMESTIC' ? (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Delivery Pin Code</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-2.5 h-3.5 w-3.5 text-brand-600" />
                    <input
                      type="text"
                      value={toPincode}
                      onChange={(e) => setToPincode(e.target.value)}
                      placeholder="e.g., 560038"
                      className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 font-mono font-semibold text-slate-900 focus:border-brand-600 focus:outline-none"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Destination Country (220+)</label>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-900 focus:border-brand-600 focus:outline-none"
                  >
                    {(network?.internationalDestinations ?? [
                      { code: 'US', name: 'United States' },
                      { code: 'GB', name: 'United Kingdom' },
                      { code: 'AE', name: 'United Arab Emirates' },
                      { code: 'SG', name: 'Singapore' },
                      { code: 'DE', name: 'Germany & EU' },
                      { code: 'CA', name: 'Canada' },
                      { code: 'AU', name: 'Australia' },
                    ]).map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.name} ({d.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Service Tier + Weight + Promo */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Service Tier</label>
                {scope === 'INTERNATIONAL' ? (
                  <input
                    type="text"
                    readOnly
                    value="INTERNATIONAL"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 font-semibold text-slate-700"
                  />
                ) : (
                  <select
                    value={serviceType}
                    onChange={(e) => setServiceType(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 font-semibold text-slate-900 focus:border-brand-600 focus:outline-none"
                  >
                    <option value="LOCAL">Local Standard</option>
                    <option value="EXPRESS">Express Parcel</option>
                    <option value="EXPRESS_PREMIUM">Express Premium (Next-Day)</option>
                    <option value="AIRMAX">AirMax Cargo</option>
                    <option value="INTERCITY">Intercity Surface</option>
                    <option value="HYPERLOCAL">Hyperlocal Rapid</option>
                    <option value="LTL_FREIGHT">LTL Freight</option>
                    <option value="FTL_FREIGHT">Full Truckload (FTL)</option>
                    <option value="SCHEDULED">Scheduled Window</option>
                    <option value="RETURN">Reverse Pickup</option>
                  </select>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Weight (kg)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.2"
                  value={weightKg}
                  onChange={(e) => setWeightKg(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-semibold text-slate-900 focus:border-brand-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Promo Code</label>
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  placeholder="Optional"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-semibold uppercase text-slate-900 focus:border-brand-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Quick Corridor Preset Pills */}
            {scope === 'DOMESTIC' && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {PRESET_CORRIDORS.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => {
                      setFromPincode(c.from);
                      setToPincode(c.to);
                      setServiceType(c.service);
                      if (c.to === '600001') setMode('PARTNER');
                    }}
                    className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-brand-50 hover:text-brand-700 transition"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}

            <button
              type="submit"
              disabled={checking}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-600 transition disabled:opacity-60"
            >
              {checking ? 'Checking Network & Rates...' : 'Calculate Rate & Check Pincodes'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {/* Live Quote Results */}
          <AnimatePresence>
            {(serviceInfo || calcError || options.length > 0) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-xs"
              >
                {serviceInfo && (
                  <p className="font-semibold text-brand-700">{serviceInfo}</p>
                )}
                {calcError && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-800 font-medium">
                    {calcError}
                  </div>
                )}
                {options.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {options.map((opt) => (
                      <div
                        key={opt.optionId}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 hover:border-brand-300 transition"
                      >
                        <div>
                          <p className="font-bold text-slate-900">{opt.carrierTypeLabel}</p>
                          <p className="text-[11px] text-slate-500">
                            ETA {opt.etaDays} day(s)
                            {opt.breakdown?.promoDiscount
                              ? ` • Saved ₹${opt.breakdown.promoDiscount.toFixed(0)} (${opt.breakdown.appliedPromoCode})`
                              : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-sm font-extrabold text-slate-900 tabular-nums">
                            ₹{opt.price.toFixed(2)}
                          </span>
                          <Link
                            href={buildBookUrl(opt)}
                            className="rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-brand-700 transition"
                          >
                            Book
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Instant AWB Quick Track Mini Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (trackAwb.trim()) router.push(`/track?awb=${encodeURIComponent(trackAwb.trim())}`);
            }}
            className="mt-4 flex gap-2 border-t border-slate-100 pt-3"
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={trackAwb}
                onChange={(e) => setTrackAwb(e.target.value)}
                placeholder="Track existing AWB (e.g., BC2611...)"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-xs font-mono focus:bg-white focus:border-brand-600 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
            >
              Track
            </button>
          </form>
        </motion.div>
      </div>

      {/* Responsive PWA / Mobile Portal Info Modal */}
      <AnimatePresence>
        {showMobileAppModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
            onClick={() => setShowMobileAppModal(false)}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              className="max-w-md w-full rounded-2xl bg-white p-6 text-slate-900 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Smartphone className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-extrabold text-slate-900">Mobile-Ready Courier Experience</h3>
                  <p className="text-xs text-slate-500">Responsive web portals for customers &amp; field agents</p>
                </div>
              </div>
              <p className="mt-4 text-xs text-slate-600 leading-relaxed">
                Every workflow—quick pincode booking, barcode scanning, OTP delivery verification, and live tracking—works natively in mobile browsers. Add this page to your phone&apos;s Home Screen from Chrome/Safari for instant app-like access.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowMobileAppModal(false)}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

