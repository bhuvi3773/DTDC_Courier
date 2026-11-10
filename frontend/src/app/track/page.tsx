'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  trackPublic,
  PublicShipment,
  verifyDeliveryOtp,
  resendDeliveryOtp,
  supervisorDeliveryBypass,
  submitNdrAction,
} from '@/lib/api';
import { getToken } from '@/lib/auth';
import { useAuthSession } from '@/hooks/useAuthSession';
import {
  Search,
  Truck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  KeyRound,
  ShieldCheck,
  RefreshCw,
  Globe2,
  CalendarClock,
  IndianRupee,
} from 'lucide-react';

const MILESTONES = [
  { key: 'BOOKED', label: 'Booked' },
  { key: 'PICKED_UP', label: 'Picked Up' },
  { key: 'AT_ORIGIN_HUB', label: 'Origin Hub' },
  { key: 'IN_TRANSIT', label: 'In Transit' },
  { key: 'AT_DESTINATION_HUB', label: 'Dest Hub' },
  { key: 'OUT_FOR_DELIVERY', label: 'Out for Delivery' },
  { key: 'DELIVERED', label: 'Delivered' },
];

function computeMilestoneIndex(status: string): number {
  const s = status.toUpperCase();
  if (s === 'DELIVERED') return 6;
  if (s === 'OUT_FOR_DELIVERY' || s === 'DELIVERY_FAILED') return 5;
  if (s === 'AT_DESTINATION_HUB') return 4;
  if (s === 'IN_TRANSIT' || s === 'RTO_IN_TRANSIT') return 3;
  if (s === 'AT_ORIGIN_HUB') return 2;
  if (s === 'PICKED_UP' || s === 'PICKUP_SCHEDULED' || s === 'PICKUP_FAILED') return 1;
  return 0;
}

export default function TrackPage() {
  const session = useAuthSession();
  const [awb, setAwb] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shipment, setShipment] = useState<PublicShipment | null>(null);

  // Delivery OTP states
  const [otpCode, setOtpCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpMessage, setOtpMessage] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [showBypassModal, setShowBypassModal] = useState(false);
  const [bypassReason, setBypassReason] = useState('');
  const [bypassProofUrl, setBypassProofUrl] = useState('');

  // NDR Self-service states
  const [ndrDate, setNdrDate] = useState(() => new Date(Date.now() + 864e5).toISOString().slice(0, 10));
  const [ndrRemarks, setNdrRemarks] = useState('');
  const [ndrMsg, setNdrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const qAwb = params.get('awb');
      if (qAwb) {
        setAwb(qAwb);
        setLoading(true);
        trackPublic(qAwb.trim())
          .then((data) => setShipment(data))
          .catch((err) => setError(err?.message || 'Shipment not found'))
          .finally(() => setLoading(false));
      }
    }
  }, []);

  const handleTrack = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!awb.trim()) return;

    setLoading(true);
    setError(null);
    setOtpMessage(null);
    setOtpError(null);
    setNdrMsg(null);

    try {
      const data = await trackPublic(awb.trim());
      setShipment(data);
    } catch (err: any) {
      setShipment(null);
      setError(err?.message || 'Shipment not found. Please verify the AWB number.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shipment || !otpCode || otpCode.length !== 6) {
      setOtpError('Please enter a valid 6-digit code');
      return;
    }

    setOtpLoading(true);
    setOtpError(null);
    setOtpMessage(null);

    try {
      const token = getToken() ?? undefined;
      await verifyDeliveryOtp(shipment.awb, otpCode, token);
      setOtpMessage('Delivery confirmed successfully! Package marked DELIVERED.');
      await handleTrack();
    } catch (err: any) {
      setOtpError(err?.message || 'Verification failed. Please check the code.');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!shipment) return;
    setOtpLoading(true);
    setOtpError(null);
    setOtpMessage(null);
    try {
      const token = getToken() ?? undefined;
      const res = await resendDeliveryOtp(shipment.awb, token);
      setOtpMessage(
        res.code
          ? `Fresh Delivery OTP issued (dev SMS preview): ${res.code}`
          : 'A fresh 6-digit verification OTP has been dispatched.',
      );
    } catch (err: any) {
      setOtpError(err?.message || 'Could not resend OTP yet (60s cooldown applies).');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleSupervisorBypass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shipment || !bypassReason.trim()) return;
    setOtpLoading(true);
    setOtpError(null);
    try {
      const token = getToken() ?? undefined;
      await supervisorDeliveryBypass(shipment.awb, bypassReason, bypassProofUrl || undefined, token);
      setShowBypassModal(false);
      setOtpMessage('Supervisor delivery override applied. Parcel marked DELIVERED.');
      await handleTrack();
    } catch (err: any) {
      setOtpError(err?.message || 'Override failed');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleNdrReschedule = async () => {
    const token = getToken();
    if (!token || !shipment) return;
    setOtpError(null);
    try {
      await submitNdrAction(
        shipment.awb,
        { action: 'RESCHEDULE', rescheduleDate: ndrDate, remarks: ndrRemarks || 'Customer rescheduled delivery slot' },
        token,
      );
      setNdrMsg(`Re-attempt scheduled for ${ndrDate}. Operations notified!`);
      await handleTrack();
    } catch (err: any) {
      setOtpError(err?.message || 'Failed to schedule re-attempt');
    }
  };

  const isOutOfDelivery = shipment?.status === 'OUT_FOR_DELIVERY';
  const isDelivered = shipment?.status === 'DELIVERED';
  const isFailed = shipment?.status === 'DELIVERY_FAILED' || shipment?.status === 'PICKUP_FAILED';
  const currentMilestone = shipment ? computeMilestoneIndex(shipment.status) : 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 border border-brand-200 px-3 py-1 text-[11px] font-bold text-brand-700">
          <Truck className="h-3.5 w-3.5" /> Real-Time Multi-Carrier Tracking
        </span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">
          Track Your <span className="text-brand-600">Courier Shipment</span>
        </h1>
        <p className="mt-2 text-xs sm:text-sm text-slate-600">
          Live milestone updates across Own Express Network &amp; Partner Carriers (DTDC, Delhivery, BlueDart).
        </p>
      </div>

      {/* AWB Search Input */}
      <form onSubmit={handleTrack} className="mt-6 flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <input
            type="text"
            value={awb}
            onChange={(e) => setAwb(e.target.value)}
            placeholder="Enter AWB number (e.g., BC26110000105)"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pl-10 font-mono text-sm shadow-sm focus:border-brand-600 focus:outline-none"
          />
          <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="min-h-[46px] rounded-xl bg-slate-950 px-7 py-3 text-sm font-bold text-white shadow-sm hover:bg-brand-600 transition disabled:opacity-50"
        >
          {loading ? 'Tracking...' : 'Track Shipment'}
        </button>
      </form>

      {error && (
        <div className="mt-6 rounded-xl bg-red-50 p-4 text-xs font-semibold text-red-700 border border-red-200">
          {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        {shipment && (
          <motion.div
            key={shipment.awb + shipment.status}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-8 space-y-6"
          >
            {/* Overview Card + Horizontal Milestone Stepper */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Airway Bill (AWB)
                  </span>
                  <p className="font-mono text-xl font-extrabold text-slate-900">{shipment.awb}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {shipment.carrier && (
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold border ${
                        shipment.carrier.carrierType === 'PARTNER'
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          : 'bg-brand-50 text-brand-700 border-brand-200'
                      }`}
                    >
                      {shipment.carrier.carrierName}
                      {shipment.carrier.externalAwb ? ` • ${shipment.carrier.externalAwb}` : ''}
                    </span>
                  )}

                  {shipment.paymentMethod === 'COD' && shipment.codAmount != null && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-3 py-1 text-xs font-bold text-rose-700">
                      <IndianRupee className="h-3 w-3" /> COD ₹{shipment.codAmount.toFixed(0)}
                    </span>
                  )}

                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                      isDelivered
                        ? 'bg-emerald-100 text-emerald-800'
                        : isFailed
                        ? 'bg-red-100 text-red-800'
                        : isOutOfDelivery
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-brand-50 text-brand-700'
                    }`}
                  >
                    {isDelivered && <CheckCircle2 className="h-3.5 w-3.5" />}
                    {isOutOfDelivery && <Truck className="h-3.5 w-3.5" />}
                    {shipment.status.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>

              {/* Animated Visual Journey Strip */}
              <div className="mt-6 hidden sm:block">
                <div className="relative flex items-center justify-between">
                  <div className="absolute left-0 right-0 top-3.5 h-1 rounded-full bg-slate-100" />
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(currentMilestone / (MILESTONES.length - 1)) * 100}%` }}
                    transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute left-0 top-3.5 h-1 rounded-full bg-brand-600"
                  />
                  {MILESTONES.map((m, idx) => {
                    const active = idx <= currentMilestone;
                    return (
                      <div key={m.key} className="relative z-10 flex flex-col items-center">
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold border-2 transition ${
                            active
                              ? 'border-brand-600 bg-brand-600 text-white'
                              : 'border-slate-200 bg-white text-slate-400'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className={`mt-1.5 text-[10px] font-semibold ${active ? 'text-slate-900' : 'text-slate-400'}`}>
                          {m.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4 text-xs">
                <div>
                  <span className="text-slate-400 font-medium">Service Tier</span>
                  <p className="font-bold text-slate-800 mt-0.5">{shipment.serviceType.replace(/_/g, ' ')}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Origin</span>
                  <p className="font-bold text-slate-800 mt-0.5">
                    {shipment.origin ? `${shipment.origin.city} (${shipment.origin.pincode})` : 'Origin Hub'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Destination</span>
                  <p className="font-bold text-slate-800 mt-0.5 inline-flex items-center gap-1">
                    {shipment.destinationCountry && shipment.destinationCountry !== 'IN' && (
                      <Globe2 className="h-3.5 w-3.5 text-brand-600" />
                    )}
                    {shipment.recipient?.city ?? 'Destination'} ({shipment.recipient?.pincode ?? '-'})
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Estimated Delivery</span>
                  <p className="font-bold text-slate-800 mt-0.5">
                    {shipment.estimatedDeliveryAt
                      ? new Date(shipment.estimatedDeliveryAt).toLocaleDateString()
                      : '1–3 business days'}
                  </p>
                </div>
              </div>
            </div>

            {/* NDR Self-Service Reschedule Card (when failed & signed in) */}
            {isFailed && session.token && (
              <div className="rounded-2xl border-2 border-rose-200 bg-rose-50/60 p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <CalendarClock className="h-6 w-6 text-rose-600" />
                  <div>
                    <h3 className="font-bold text-slate-900">Action Required: Schedule Re-Attempt (NDR)</h3>
                    <p className="text-xs text-slate-600">
                      Recent attempt was unsuccessful. Request a new date and delivery instruction directly.
                    </p>
                  </div>
                </div>
                {ndrMsg && (
                  <div className="mt-3 rounded-lg bg-emerald-100 p-2.5 text-xs font-semibold text-emerald-800">
                    {ndrMsg}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-3 items-center text-xs">
                  <input
                    type="date"
                    value={ndrDate}
                    onChange={(e) => setNdrDate(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                  />
                  <input
                    type="text"
                    value={ndrRemarks}
                    onChange={(e) => setNdrRemarks(e.target.value)}
                    placeholder="Landmark / Alternate phone note"
                    className="flex-1 min-w-[200px] rounded-lg border border-slate-300 bg-white px-3 py-2"
                  />
                  <button
                    type="button"
                    onClick={handleNdrReschedule}
                    className="rounded-lg bg-rose-600 px-4 py-2 font-bold text-white hover:bg-rose-700"
                  >
                    Request Re-Attempt
                  </button>
                </div>
              </div>
            )}

            {/* OTP Delivery Verification Card */}
            {isOutOfDelivery && shipment.carrier?.carrierType !== 'PARTNER' && (
              <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/70 p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <KeyRound className="h-6 w-6 text-amber-600" />
                  <div>
                    <h3 className="font-bold text-slate-900">Recipient OTP Delivery Verification</h3>
                    <p className="text-xs text-slate-600">
                      Supply the 6-digit verification code to confirm doorstep handover.
                    </p>
                  </div>
                </div>

                {otpMessage && (
                  <div className="mt-4 rounded-lg bg-emerald-100 p-3 text-xs font-semibold text-emerald-800 border border-emerald-200">
                    {otpMessage}
                  </div>
                )}
                {otpError && (
                  <div className="mt-4 rounded-lg bg-red-100 p-3 text-xs font-semibold text-red-800 border border-red-200">
                    {otpError}
                  </div>
                )}

                <form onSubmit={handleVerifyOtp} className="mt-4 flex flex-wrap items-center gap-3">
                  <input
                    type="text"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="6-digit code"
                    className="w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-lg font-mono font-bold tracking-widest focus:border-brand-600 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={otpLoading || otpCode.length !== 6}
                    className="rounded-lg bg-brand-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
                  >
                    {otpLoading ? 'Verifying...' : 'Verify & Deliver'}
                  </button>
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={otpLoading}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw className="h-3 w-3" /> Resend Code
                  </button>
                  {session.capabilities.canBypassDeliveryOtp && (
                    <button
                      type="button"
                      onClick={() => setShowBypassModal(true)}
                      className="ml-auto text-xs font-semibold text-slate-600 underline hover:text-slate-900"
                    >
                      Supervisor Override
                    </button>
                  )}
                </form>

                {showBypassModal && (
                  <div className="mt-4 border-t border-amber-200 pt-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-brand-600" /> Supervisor Exception Bypass
                    </h4>
                    <form onSubmit={handleSupervisorBypass} className="mt-3 space-y-3">
                      <input
                        type="text"
                        value={bypassReason}
                        onChange={(e) => setBypassReason(e.target.value)}
                        placeholder="Mandatory reason for override"
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs"
                      />
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={bypassProofUrl}
                          onChange={(e) => setBypassProofUrl(e.target.value)}
                          placeholder="Optional proof URL"
                          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs"
                        />
                        <button
                          type="submit"
                          disabled={otpLoading || !bypassReason.trim()}
                          className="rounded-md bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                        >
                          Confirm Bypass
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowBypassModal(false)}
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            )}

            {/* Vertical Timeline */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Live Shipment Journey ({shipment.timeline.length} Events)
              </h3>

              <div className="mt-6 space-y-6">
                {shipment.timeline.map((entry, idx) => {
                  const isLatest = idx === 0;
                  return (
                    <div key={idx} className="relative flex gap-4">
                      <div className="flex flex-col items-center">
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-full ${
                            isLatest
                              ? 'bg-brand-600 text-white ring-4 ring-brand-100'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {entry.exceptionCode ? (
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                          ) : entry.status === 'DELIVERED' ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <Clock className="h-4 w-4" />
                          )}
                        </div>
                        {idx !== shipment.timeline.length - 1 && (
                          <div className="w-0.5 flex-1 bg-slate-200" />
                        )}
                      </div>

                      <div className="pb-6">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">
                            {entry.status?.replace(/_/g, ' ') ?? entry.exceptionCode ?? 'STATUS UPDATE'}
                          </span>
                          {isLatest && (
                            <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                              Latest
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {new Date(entry.eventTime).toLocaleString()}
                          {entry.locationLabel && ` • ${entry.locationLabel}`}
                        </p>
                        {entry.remarks && (
                          <p className="mt-1.5 text-xs text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100">
                            {entry.remarks}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
