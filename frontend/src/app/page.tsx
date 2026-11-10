'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Globe2,
  Layers,
  Package,
  ScanLine,
  ShieldCheck,
  ThermometerSnowflake,
  Truck,
  Zap,
} from 'lucide-react';
import { QuickBookingHeroWidget } from '@/components/QuickBookingHeroWidget';
import { FadeUp, StaggerCard, StaggerGrid } from '@/components/MotionPrimitives';
import { COURIER_SERVICES, COURIER_SOLUTIONS } from '@/data/courierCatalog';

const SERVICE_GROUPS = [
  { id: 'ALL', label: 'All Services' },
  { id: 'EXPRESS', label: 'Express & Priority' },
  { id: 'HEAVY', label: 'Freight & 3PL' },
  { id: 'GLOBAL', label: 'International' },
] as const;

export default function Home() {
  const [filter, setFilter] = useState<(typeof SERVICE_GROUPS)[number]['id']>('ALL');

  const filteredServices = COURIER_SERVICES.filter((s) => {
    if (filter === 'ALL') return true;
    if (filter === 'EXPRESS') return ['express-parcel', 'express-premium', 'airmax', 'hyperlocal-local'].includes(s.slug);
    if (filter === 'HEAVY') return ['ltl-ptl', 'ftl', '3pl-warehousing'].includes(s.slug);
    if (filter === 'GLOBAL') return s.slug === 'international';
    return true;
  });

  return (
    <div className="bg-slate-50">
      {/* Delhivery/DTDC Flagship Dark Hero + Quick Rate & Pincode Widget */}
      <QuickBookingHeroWidget />

      {/* Section 1: Core Services Portfolio */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <FadeUp className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-brand-600">
              Complete Delivery Spectrum
            </span>
            <h2 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              Courier, Freight &amp; Global Services
            </h2>
            <p className="mt-1 text-sm text-slate-600 max-w-2xl">
              From urgent intra-city documents to AirMax cargo, LTL freight, 3PL storage, and 220+ international destinations.
            </p>
          </div>

          <div className="inline-flex flex-wrap gap-1 rounded-xl bg-white p-1 border border-slate-200 text-xs font-semibold">
            {SERVICE_GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setFilter(g.id)}
                className={`relative rounded-lg px-3 py-1.5 transition ${
                  filter === g.id ? 'text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {filter === g.id && (
                  <motion.span
                    layoutId="homeServiceTab"
                    transition={{ type: 'spring', stiffness: 450, damping: 30 }}
                    className="absolute inset-0 rounded-lg bg-slate-900"
                  />
                )}
                <span className="relative z-10">{g.label}</span>
              </button>
            ))}
          </div>
        </FadeUp>

        <StaggerGrid className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {filteredServices.map((svc) => (
            <StaggerCard
              key={svc.slug}
              className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-card hover:border-brand-300 hover:shadow-glass transition"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    {svc.slug === 'international' ? (
                      <Globe2 className="h-4.5 w-4.5" />
                    ) : svc.slug === 'airmax' || svc.slug === 'express-premium' ? (
                      <Zap className="h-4.5 w-4.5" />
                    ) : svc.slug === '3pl-warehousing' ? (
                      <Layers className="h-4.5 w-4.5" />
                    ) : (
                      <Package className="h-4.5 w-4.5" />
                    )}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-600">
                    {svc.sla}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-bold text-slate-900">{svc.title}</h3>
                <p className="mt-1 text-xs font-medium text-brand-700">{svc.tagline}</p>
                <p className="mt-2 text-xs text-slate-600 leading-relaxed">{svc.description}</p>
              </div>

              <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                {svc.badge ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-express-600">
                    {svc.badge}
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold text-slate-400">Live Pricing</span>
                )}
                <Link
                  href={svc.ctaHref}
                  className="inline-flex items-center gap-1 text-xs font-bold text-slate-900 hover:text-brand-600 transition"
                >
                  {svc.ctaLabel} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </StaggerCard>
          ))}
        </StaggerGrid>
      </section>

      {/* Section 2: Separated Own Fleet vs Pre-Existing Partner Courier Choice */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <FadeUp className="text-center max-w-2xl mx-auto">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-600">
              Dual Fulfillment Architecture
            </span>
            <h2 className="mt-1 text-2xl sm:text-3xl font-extrabold text-slate-900">
              Own Courier Fleet OR Pre-Existing Partners — Your Choice
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-600">
              Both networks remain cleanly separated at quoting, booking, labeling, and billing — pick dedicated first/last-mile control or external national partner reach.
            </p>
          </FadeUp>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <FadeUp delay={0.05} className="rounded-2xl border-2 border-brand-200 bg-brand-50/40 p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-3 py-1 text-xs font-bold text-white">
                    <ShieldCheck className="h-3.5 w-3.5" /> Channel 1: Own Express Network
                  </span>
                  <span className="text-xs font-bold text-brand-700">End-to-End Controlled</span>
                </div>
                <h3 className="mt-4 text-xl font-extrabold text-slate-900">Verified Doorstep Pickup &amp; 6-Digit OTP</h3>
                <ul className="mt-4 space-y-2 text-xs text-slate-700">
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-brand-600 shrink-0" /> Uniformed field agents pick up in chosen 2-hour windows</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-brand-600 shrink-0" /> Custom waterproof, fragile &amp; cold-chain packaging tiers</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-brand-600 shrink-0" /> Live hub IN/OUT barcode scans &amp; mandatory OTP handover</li>
                </ul>
              </div>
              <Link
                href="/book?mode=OWN"
                className="mt-6 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-700 transition"
              >
                Book via Own Courier Fleet <ArrowRight className="h-4 w-4" />
              </Link>
            </FadeUp>

            <FadeUp delay={0.1} className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/40 p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-3 py-1 text-xs font-bold text-white">
                    <Truck className="h-3.5 w-3.5" /> Channel 2: Partner Carrier Network
                  </span>
                  <span className="text-xs font-bold text-indigo-700">DTDC &bull; Delhivery &bull; BlueDart</span>
                </div>
                <h3 className="mt-4 text-xl font-extrabold text-slate-900">Compare &amp; Ship with Leading 3P Carriers</h3>
                <ul className="mt-4 space-y-2 text-xs text-slate-700">
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-indigo-600 shrink-0" /> Side-by-side rates &amp; transit ETAs across DTDC, Delhivery &amp; BlueDart</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-indigo-600 shrink-0" /> Pan-India 18,700+ pincode &amp; 220+ international country coverage</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-indigo-600 shrink-0" /> Unified external AWB tracking &amp; automated GST tax invoicing</li>
                </ul>
              </div>
              <Link
                href="/book?mode=PARTNER"
                className="mt-6 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-700 transition"
              >
                Compare Partner Couriers <ArrowRight className="h-4 w-4" />
              </Link>
            </FadeUp>
          </div>
        </div>
      </section>

      {/* Section 3: Business & Industry Solutions (DTDC Solutions Parity) */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <FadeUp className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-express-600">
              Tailored Supply Chain Solutions
            </span>
            <h2 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              Built for Personal, B2B, Cold-Chain &amp; ONDC
            </h2>
          </div>
          <Link
            href="/courier"
            className="text-xs font-bold text-brand-700 hover:underline flex items-center gap-1"
          >
            Compare All Tiers &amp; Request 3PL/FTL <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </FadeUp>

        <StaggerGrid className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {COURIER_SOLUTIONS.map((sol) => (
            <StaggerCard
              key={sol.slug}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card hover:border-slate-300 hover:shadow-glass transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
                    {sol.slug === 'temperature-controlled' ? (
                      <ThermometerSnowflake className="h-4.5 w-4.5 text-sky-300" />
                    ) : sol.slug === 'b2b-corporate' ? (
                      <Building2 className="h-4.5 w-4.5 text-brand-400" />
                    ) : (
                      <ScanLine className="h-4.5 w-4.5 text-brand-400" />
                    )}
                  </span>
                  {sol.badge && (
                    <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[10px] font-bold text-brand-700 border border-brand-200">
                      {sol.badge}
                    </span>
                  )}
                </div>
                <h3 className="mt-4 text-base font-bold text-slate-900">{sol.title}</h3>
                <p className="mt-1 text-xs font-semibold text-slate-700">{sol.tagline}</p>
                <p className="mt-2 text-xs text-slate-500 leading-relaxed">{sol.description}</p>
              </div>
              <Link
                href={sol.ctaHref}
                className="mt-5 inline-flex items-center gap-1.5 text-xs font-bold text-brand-700 hover:text-brand-900"
              >
                {sol.ctaLabel} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </StaggerCard>
          ))}
        </StaggerGrid>
      </section>
    </div>
  );
}
