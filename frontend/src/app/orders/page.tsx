'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  listShipments,
  downloadShipmentLabel,
  downloadShipmentInvoice,
  cancelShipment,
  resendDeliveryOtp,
  submitNdrAction,
} from '@/lib/api';
import { useAuthSession } from '@/hooks/useAuthSession';
import { AccessRestricted } from '@/components/AccessRestricted';
import {
  Package,
  Truck,
  CheckCircle2,
  KeyRound,
  ArrowRight,
  Printer,
  LifeBuoy,
  FileText,
  XCircle,
  RefreshCw,
  CalendarClock,
  IndianRupee,
} from 'lucide-react';

type FilterTab = 'ALL' | 'ACTIVE' | 'DELIVERED' | 'PARTNER' | 'NDR';

export default function OrdersPage() {
  const session = useAuthSession({ redirectIfUnauth: true });
  const token = session.token;
  const [shipments, setShipments] = useState<any[]>([]);
  const [filter, setFilter] = useState<FilterTab>('ALL');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cancel & NDR Modals
  const [cancelTarget, setCancelTarget] = useState<{ id: string; awb: string } | null>(null);
  const [cancelReason, setCancelReason] = useState('Customer requested pre-pickup cancellation');
  const [ndrTarget, setNdrTarget] = useState<{ id: string; awb: string } | null>(null);
  const [ndrActionType, setNdrActionType] = useState<'RESCHEDULE' | 'UPDATE_ADDRESS' | 'RTO'>('RESCHEDULE');
  const [ndrDate, setNdrDate] = useState(() => new Date(Date.now() + 864e5).toISOString().slice(0, 10));
  const [ndrNewLine1, setNdrNewLine1] = useState('');
  const [ndrNewPhone, setNdrNewPhone] = useState('');
  const [ndrRemarks, setNdrRemarks] = useState('');

  useEffect(() => {
    if (session.loading || !session.token) return;
    if (!session.capabilities.canViewCustomerOrders) {
      setLoading(false);
      return;
    }
    loadData(session.token);
  }, [session.loading, session.token, session.capabilities.canViewCustomerOrders]);

  const loadData = async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      const shipList = await listShipments({}, t);
      setShipments(shipList);
    } catch (err: any) {
      setError(err?.message || 'Failed to load your shipments');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!token || !cancelTarget) return;
    setError(null);
    setMessage(null);
    try {
      const res = await cancelShipment(cancelTarget.id, cancelReason, token);
      setMessage(
        `Shipment ${cancelTarget.awb} cancelled.${res.refunded > 0 ? ` Refund initiated: ₹${res.refunded}` : ''}`,
      );
      setCancelTarget(null);
      await loadData(token);
    } catch (err: any) {
      setError(err?.message || 'Unable to cancel shipment');
    }
  };

  const handleResendOtp = async (s: any) => {
    if (!token) return;
    setError(null);
    setMessage(null);
    try {
      const r = await resendDeliveryOtp(s.id, token);
      setMessage(
        r.code
          ? `Fresh Delivery OTP for ${s.awb}: ${r.code}`
          : `Fresh Delivery OTP sent to recipient phone for ${s.awb}.`,
      );
    } catch (err: any) {
      setError(err?.message || 'Cannot resend OTP right now');
    }
  };

  const handleSubmitNdr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !ndrTarget) return;
    setError(null);
    setMessage(null);
    try {
      await submitNdrAction(
        ndrTarget.id,
        {
          action: ndrActionType,
          rescheduleDate: ndrActionType !== 'RTO' ? ndrDate : undefined,
          newLine1: ndrActionType === 'UPDATE_ADDRESS' && ndrNewLine1 ? ndrNewLine1 : undefined,
          newPhone: ndrActionType === 'UPDATE_ADDRESS' && ndrNewPhone ? ndrNewPhone : undefined,
          remarks: ndrRemarks || undefined,
        },
        token,
      );
      setMessage(`NDR update (${ndrActionType}) applied on ${ndrTarget.awb}.`);
      setNdrTarget(null);
      await loadData(token);
    } catch (err: any) {
      setError(err?.message || 'Failed to submit NDR instruction');
    }
  };

  if (session.loading) {
    return <div className="py-12 text-center text-xs text-slate-500">Checking session permissions...</div>;
  }
  if (!session.capabilities.canViewCustomerOrders) {
    return (
      <AccessRestricted
        roleLabel={session.capabilities.label}
        requiredLabel="Customer accounts"
        fallbackHref={session.capabilities.defaultHome}
      />
    );
  }

  const filtered = shipments.filter((s) => {
    if (filter === 'DELIVERED') return s.status === 'DELIVERED';
    if (filter === 'PARTNER') return s.shipmentType === 'PARTNER_DIRECT_SHIPMENT' || s.legs?.some((l: any) => l.carrierType === 'PARTNER');
    if (filter === 'NDR') return ['DELIVERY_FAILED', 'PICKUP_FAILED', 'RTO_INITIATED'].includes(s.status);
    if (filter === 'ACTIVE') return !['DELIVERED', 'CANCELLED', 'RTO_DELIVERED'].includes(s.status);
    return true;
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            My <span className="text-brand-600">Shipments</span>
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Manage courier bookings, download A5 QR Labels &amp; GST Invoices, reschedule NDR attempts, or cancel pre-pickup dispatches.
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href="/business"
            className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            Bulk CSV Portal
          </Link>
          <Link
            href="/book"
            className="flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-brand-700"
          >
            <Package className="h-3.5 w-3.5" /> Book New Courier
          </Link>
        </div>
      </div>

      {message && (
        <div className="mt-4 rounded-xl bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-800 border border-emerald-200">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-xl bg-red-50 p-3.5 text-xs font-semibold text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {/* Filter Chips */}
      <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold">
        {(
          [
            ['ALL', `All (${shipments.length})`],
            ['ACTIVE', 'In Transit / Scheduled'],
            ['DELIVERED', 'Delivered'],
            ['PARTNER', 'Partner Couriers (3P)'],
            ['NDR', 'Action / NDR'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`relative rounded-xl px-3.5 py-1.5 border transition ${
              filter === key
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-500">Loading your shipments...</div>
      ) : (
        <div className="mt-6 space-y-6">
          {/* Active OFD Handover Banner */}
          {shipments.some((s) => s.status === 'OUT_FOR_DELIVERY') && (
            <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/70 p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <KeyRound className="h-6 w-6 text-amber-600" />
                <div>
                  <h3 className="font-bold text-slate-900">Package Out for Delivery</h3>
                  <p className="text-xs text-slate-600">
                    Provide the 6-digit verification OTP to your delivery agent upon doorstep arrival.
                  </p>
                </div>
              </div>
              <Link
                href="/track"
                className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-brand-700"
              >
                Open Live Tracking Desk
              </Link>
            </div>
          )}

          {/* Shipments List */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">
            <div className="divide-y divide-slate-100">
              {filtered.map((s) => {
                const isOFD = s.status === 'OUT_FOR_DELIVERY';
                const isDelivered = s.status === 'DELIVERED';
                const canCancel = ['BOOKED', 'PICKUP_SCHEDULED', 'PICKUP_FAILED'].includes(s.status);
                const canNdr = ['DELIVERY_FAILED', 'PICKUP_FAILED'].includes(s.status);
                const primaryLeg = s.legs?.[0];
                const isPartner = primaryLeg?.carrierType === 'PARTNER';

                return (
                  <div key={s.id} className="p-5 flex flex-wrap items-center justify-between gap-4 hover:bg-slate-50/60 transition">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-extrabold text-slate-900">{s.awb}</span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                            isDelivered
                              ? 'bg-emerald-100 text-emerald-800'
                              : isOFD
                              ? 'bg-amber-100 text-amber-800'
                              : canNdr
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-brand-50 text-brand-700'
                          }`}
                        >
                          {isDelivered && <CheckCircle2 className="h-3 w-3" />}
                          {isOFD && <Truck className="h-3 w-3" />}
                          {s.status.replace(/_/g, ' ')}
                        </span>

                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                            isPartner
                              ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                              : 'border-brand-200 bg-brand-50 text-brand-700'
                          }`}
                        >
                          {isPartner
                            ? `${primaryLeg?.carrier?.name ?? 'Partner'}${primaryLeg?.externalAwb ? ` (${primaryLeg.externalAwb})` : ''}`
                            : 'Own Verified Fleet'}
                        </span>

                        {s.paymentMethod === 'COD' && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                            <IndianRupee className="h-2.5 w-2.5" /> COD ₹{Number(s.codAmount ?? 0).toFixed(0)}
                          </span>
                        )}
                        {s.paymentMethod === 'CORPORATE_CREDIT' && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                            B2B Credit
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-500">
                        {s.serviceType.replace(/_/g, ' ')} &bull; {s.packaging.replace(/_/g, ' ')}
                        {s.destinationCountry && s.destinationCountry !== 'IN' ? ` • Intl (${s.destinationCountry})` : ''}
                        {' • '}Booked {new Date(s.createdAt).toLocaleDateString()}
                        {s.financial?.customerPrice ? ` • Total ₹${Number(s.financial.customerPrice).toFixed(2)}` : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {isOFD && !isPartner && (
                        <button
                          type="button"
                          onClick={() => handleResendOtp(s)}
                          className="flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Resend OTP
                        </button>
                      )}

                      {canNdr && (
                        <button
                          type="button"
                          onClick={() => setNdrTarget({ id: s.id, awb: s.awb })}
                          className="flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                        >
                          <CalendarClock className="h-3.5 w-3.5" /> Reschedule NDR
                        </button>
                      )}

                      {canCancel && (
                        <button
                          type="button"
                          onClick={() => setCancelTarget({ id: s.id, awb: s.awb })}
                          className="flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Cancel
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          token &&
                          downloadShipmentLabel(s.id, s.awb, token).catch((e) =>
                            setError(e?.message || 'Failed to download label PDF'),
                          )
                        }
                        className="flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                      >
                        <Printer className="h-3.5 w-3.5" /> Label PDF
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          token &&
                          downloadShipmentInvoice(s.id, s.awb, token).catch((e) =>
                            setError(e?.message || 'Failed to download invoice PDF'),
                          )
                        }
                        className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        <FileText className="h-3.5 w-3.5" /> Invoice PDF
                      </button>
                      <Link
                        href={`/support?awb=${s.awb}`}
                        className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                      >
                        <LifeBuoy className="h-3.5 w-3.5" /> Issue
                      </Link>
                      <Link
                        href={`/track?awb=${s.awb}`}
                        className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Track <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                );
              })}

              {filtered.length === 0 && (
                <div className="p-10 text-center text-xs text-slate-500">
                  No matching shipments found. Book a courier pickup or upload a Bulk CSV manifest to begin.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cancel Pre-Pickup Modal */}
      <AnimatePresence>
        {cancelTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl text-xs space-y-4"
            >
              <h3 className="text-base font-extrabold text-slate-900">
                Cancel Shipment {cancelTarget.awb}?
              </h3>
              <p className="text-slate-600">
                Cancellation is allowed prior to pickup. Prepaid charges are automatically refunded.
              </p>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Reason for cancellation"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCancelTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700"
                >
                  Keep Shipment
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCancel}
                  className="rounded-lg bg-red-600 px-4 py-2 font-bold text-white hover:bg-red-700"
                >
                  Confirm Cancellation
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* NDR Reschedule / Address Modal */}
      <AnimatePresence>
        {ndrTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          >
            <motion.form
              onSubmit={handleSubmitNdr}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl text-xs space-y-4"
            >
              <h3 className="text-base font-extrabold text-slate-900">
                Resolve Failed Attempt ({ndrTarget.awb})
              </h3>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Action</label>
                <select
                  value={ndrActionType}
                  onChange={(e) => setNdrActionType(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold"
                >
                  <option value="RESCHEDULE">Reschedule Re-Attempt Date</option>
                  <option value="UPDATE_ADDRESS">Update Address / Phone &amp; Retry</option>
                  <option value="RTO">Confirm Return to Origin (RTO)</option>
                </select>
              </div>
              {ndrActionType !== 'RTO' && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Preferred Next Attempt Date</label>
                  <input
                    type="date"
                    value={ndrDate}
                    onChange={(e) => setNdrDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
              )}
              {ndrActionType === 'UPDATE_ADDRESS' && (
                <>
                  <input
                    type="text"
                    value={ndrNewLine1}
                    onChange={(e) => setNdrNewLine1(e.target.value)}
                    placeholder="Corrected street address / landmark"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                  <input
                    type="text"
                    value={ndrNewPhone}
                    onChange={(e) => setNdrNewPhone(e.target.value)}
                    placeholder="Updated recipient phone"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </>
              )}
              <input
                type="text"
                value={ndrRemarks}
                onChange={(e) => setNdrRemarks(e.target.value)}
                placeholder="Instructions for agent"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNdrTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-brand-600 px-4 py-2 font-bold text-white hover:bg-brand-700"
                >
                  Submit Instruction
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
