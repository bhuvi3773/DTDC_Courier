'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  LogOut,
  Menu,
  Package,
  ShieldCheck,
  Sparkles,
  Truck,
  UserCircle2,
  X,
} from 'lucide-react';
import { useAuthSession } from '@/hooks/useAuthSession';
import { getNavItems } from '@/lib/rbac';
import { COURIER_SERVICES, COURIER_SOLUTIONS, CourierOffering } from '@/data/courierCatalog';

const TIER_BADGE: Record<string, string> = {
  SUPER_ADMIN: 'bg-slate-900 text-white border-slate-900',
  EMPLOYEE: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  CUSTOMER: 'bg-brand-50 text-brand-700 border-brand-200',
  GUEST: 'bg-slate-100 text-slate-600 border-slate-200',
};

export function Navbar() {
  const pathname = usePathname();
  const { loading, token, role, user, capabilities, signOut } = useAuthSession();
  const [openMenu, setOpenMenu] = useState<'services' | 'solutions' | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  const isAuthPage = ['/login', '/register', '/forgot-password', '/reset-password'].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  const items = token && role ? getNavItems(role) : isAuthPage ? [] : getNavItems(null);
  const showMegaMenus =
    !isAuthPage && (capabilities.tier === 'CUSTOMER' || capabilities.tier === 'GUEST');

  // Close menus on route change or Escape / outside click
  useEffect(() => {
    setOpenMenu(null);
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, []);

  const renderMegaDropdown = (
    title: string,
    offerings: CourierOffering[],
    footerHref: string,
    footerLabel: string,
  ) => (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="absolute left-0 top-full mt-2 w-[640px] max-w-[92vw] rounded-2xl border border-slate-200/90 bg-white/95 p-5 shadow-2xl backdrop-blur-md z-50"
    >
      <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</span>
        <Link
          href={footerHref}
          onClick={() => setOpenMenu(null)}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700"
        >
          {footerLabel} &rarr;
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {offerings.map((off) => (
          <Link
            key={off.slug}
            href={off.ctaHref}
            onClick={() => setOpenMenu(null)}
            className="group rounded-xl border border-transparent p-2.5 transition hover:border-brand-100 hover:bg-brand-50/50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-900 group-hover:text-brand-700">
                {off.title}
              </span>
              {off.badge && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 group-hover:bg-brand-100 group-hover:text-brand-700">
                  {off.badge}
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-1 text-[11px] text-slate-500">{off.tagline}</p>
          </Link>
        ))}
      </div>
    </motion.div>
  );

  return (
    <header
      ref={navRef}
      className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5">
        {/* Brand Logo */}
        <Link
          href={token && role ? capabilities.defaultHome : '/login'}
          className="flex items-center gap-2 shrink-0 group"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm transition group-hover:bg-brand-600">
            <Truck className="h-4.5 w-4.5" />
          </span>
          <div className="leading-tight">
            <span className="block text-base font-extrabold tracking-tight text-slate-900">
              Book<span className="text-brand-600">Courier</span>
            </span>
            <span className="block text-[10px] font-medium tracking-wide text-slate-400 uppercase">
              Express &bull; AirMax &bull; Global
            </span>
          </div>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-1 text-xs font-semibold text-slate-700">
          {showMegaMenus && (
            <>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenMenu(openMenu === 'services' ? null : 'services')}
                  className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 transition ${
                    openMenu === 'services'
                      ? 'bg-slate-100 text-slate-900'
                      : 'hover:bg-slate-50 hover:text-brand-600'
                  }`}
                >
                  Services
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${
                      openMenu === 'services' ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                <AnimatePresence>
                  {openMenu === 'services' &&
                    renderMegaDropdown(
                      'Courier & Freight Services',
                      COURIER_SERVICES,
                      '/courier',
                      'Explore All Services & Calculator',
                    )}
                </AnimatePresence>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenMenu(openMenu === 'solutions' ? null : 'solutions')}
                  className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 transition ${
                    openMenu === 'solutions'
                      ? 'bg-slate-100 text-slate-900'
                      : 'hover:bg-slate-50 hover:text-brand-600'
                  }`}
                >
                  Solutions
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${
                      openMenu === 'solutions' ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                <AnimatePresence>
                  {openMenu === 'solutions' &&
                    renderMegaDropdown(
                      'Logistics & Business Solutions',
                      COURIER_SOLUTIONS,
                      '/business',
                      'Open B2B & Enterprise Desk',
                    )}
                </AnimatePresence>
              </div>
            </>
          )}

          {items.map((item) => {
            const baseHref = item.href.split('?')[0];
            const isActive =
              pathname === baseHref || (baseHref !== '/' && pathname.startsWith(baseHref + '/'));
            return (
              <Link
                key={item.href + item.label}
                href={item.href}
                className={`relative rounded-lg px-3 py-2 transition ${
                  isActive ? 'text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {item.label}
                {isActive && (
                  <motion.span
                    layoutId="navbarActivePill"
                    transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                    className="absolute inset-x-2 bottom-0.5 h-0.5 rounded-full bg-brand-600"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right Session Controls + Mobile Menu Button */}
        <div className="flex items-center gap-2">
          {!loading && token && role ? (
            <div className="hidden sm:flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  TIER_BADGE[capabilities.tier] ?? TIER_BADGE.GUEST
                }`}
                title={user?.name ? `${user.name} (${capabilities.label})` : capabilities.label}
              >
                {capabilities.tier === 'SUPER_ADMIN' || capabilities.tier === 'EMPLOYEE' ? (
                  <ShieldCheck className="h-3 w-3" />
                ) : (
                  <UserCircle2 className="h-3 w-3" />
                )}
                <span>{user?.name?.split(' ')[0] ?? capabilities.label}</span>
                <span className="opacity-70">&bull; {capabilities.label}</span>
              </span>
              <button
                type="button"
                onClick={signOut}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition"
              >
                <LogOut className="h-3 w-3" />
                Sign out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  pathname === '/login'
                    ? 'bg-brand-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  pathname === '/register'
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-900 text-white hover:bg-slate-800'
                }`}
              >
                Sign up
              </Link>
            </div>
          )}

          {!isAuthPage && (
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="inline-flex lg:hidden h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileOpen && !isAuthPage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
            className="border-t border-slate-200 bg-white lg:hidden overflow-hidden"
          >
            <div className="space-y-4 px-4 py-4 text-sm">
              <div className="flex flex-col gap-1">
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className="min-h-[44px] flex items-center justify-between rounded-xl px-3 py-2 font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>

              {showMegaMenus && (
                <div className="border-t border-slate-100 pt-3">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <Package className="h-3.5 w-3.5" /> Services &amp; Solutions
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {[...COURIER_SERVICES.slice(0, 6), ...COURIER_SOLUTIONS.slice(0, 4)].map((off) => (
                      <Link
                        key={off.slug}
                        href={off.ctaHref}
                        onClick={() => setMobileOpen(false)}
                        className="rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:border-brand-200 hover:text-brand-700"
                      >
                        {off.title}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {!loading && token && role && (
                <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
                  <div className="text-xs">
                    <p className="font-bold text-slate-900">{user?.name}</p>
                    <p className="text-slate-500">{capabilities.label}</p>
                  </div>
                  <button
                    type="button"
                    onClick={signOut}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
