import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { Navbar } from '@/components/Navbar';
import { MotionProvider } from '@/components/MotionPrimitives';
import './globals.css';

const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'BookCourier — Express Parcel, AirMax, Freight & Global Logistics',
  description:
    'Integrated domestic & international courier platform: Own Express Network, Pre-Existing Partner Couriers (DTDC, Delhivery, BlueDart), Bulk B2B CSV, 3PL & ONDC Logistics.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen flex flex-col font-sans">
        <MotionProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-slate-200 bg-slate-950 text-slate-300">
            <div className="mx-auto max-w-6xl px-4 py-8 grid gap-6 sm:grid-cols-4 text-xs">
              <div className="sm:col-span-2 space-y-2">
                <p className="text-base font-extrabold tracking-tight text-white">
                  Book<span className="text-brand-400">Courier</span> Express
                </p>
                <p className="text-slate-400 leading-relaxed max-w-md">
                  Unified Express Parcel, AirMax Cargo, LTL/FTL Freight, 3PL Warehousing, and International 220+ country shipping — powered by Own Verified Fleet &amp; Partner Carrier integrations.
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="font-semibold text-white uppercase tracking-wider text-[11px]">Services &amp; Tools</p>
                <ul className="space-y-1 text-slate-400">
                  <li><a href="/courier" className="hover:text-white transition">Express, AirMax &amp; Freight</a></li>
                  <li><a href="/book" className="hover:text-white transition">Book Personal Courier</a></li>
                  <li><a href="/business" className="hover:text-white transition">B2B Bulk CSV &amp; ONDC API</a></li>
                  <li><a href="/track" className="hover:text-white transition">Live AWB Tracking</a></li>
                </ul>
              </div>
              <div className="space-y-1.5">
                <p className="font-semibold text-white uppercase tracking-wider text-[11px]">Network Assurance</p>
                <ul className="space-y-1 text-slate-400">
                  <li>6-Digit Recipient OTP Handover</li>
                  <li>GST Tax Invoices &amp; A5 QR Labels</li>
                  <li>COD &amp; Corporate Credit Billing</li>
                  <li>24x7 Claims &amp; NDR Desk</li>
                </ul>
              </div>
            </div>
            <div className="border-t border-slate-800/80 py-3 px-4 text-center text-[11px] text-slate-500">
              &copy; {new Date().getFullYear()} BookCourier Express Logistics &bull; Unified Own Network + Partner Fulfillment
            </div>
          </footer>
        </MotionProvider>
      </body>
    </html>
  );
}
