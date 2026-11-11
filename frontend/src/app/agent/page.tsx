'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  getAgentProfile,
  toggleAgentAvailability,
  listAgentTasks,
  acceptAgentTask,
  confirmPickupTask,
  failPickupTask,
  startDeliveryTask,
  confirmDeliveryTask,
  failDeliveryTask,
  scanBarcodeAsAgent,
  listAgents,
  HydratedTask,
  AgentProfileResponse,
  AgentSummary,
} from '@/lib/api';
import { useAuthSession } from '@/hooks/useAuthSession';
import { AccessRestricted } from '@/components/AccessRestricted';
import {
  Bike,
  CheckCircle2,
  AlertTriangle,
  ScanBarcode,
  RefreshCw,
  MapPin,
  Package,
  KeyRound,
  Phone,
  Power,
  XCircle,
  Truck,
} from 'lucide-react';

export default function AgentPortalPage() {
  const session = useAuthSession({ redirectIfUnauth: true });
  const token = session.token;
  const [profile, setProfile] = useState<AgentProfileResponse | null>(null);
  const [agentsList, setAgentsList] = useState<AgentSummary[]>([]);
  const [selectedStaffAgentId, setSelectedStaffAgentId] = useState<string>('');

  const [tab, setTab] = useState<'my' | 'pool' | 'history'>('my');
  const [tasks, setTasks] = useState<HydratedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Barcode scan state
  const [scanCode, setScanCode] = useState('');
  const [scanning, setScanning] = useState(false);

  // Per-task OTP and failure inputs
  const [otpInputs, setOtpInputs] = useState<Record<string, string>>({});
  const [remarksInputs, setRemarksInputs] = useState<Record<string, string>>({});
  const [failModalTask, setFailModalTask] = useState<HydratedTask | null>(null);
  const [failReason, setFailReason] = useState('Customer unavailable at doorstep');
  const [failCode, setFailCode] = useState('RECIPIENT_UNAVAILABLE');

  useEffect(() => {
    if (session.loading || !session.token) return;
    if (!session.capabilities.canViewAgentPortal) {
      setLoading(false);
      return;
    }
    loadInitial(session.token);
  }, [session.loading, session.token, session.capabilities.canViewAgentPortal]);

  const loadInitial = async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      const prof = await getAgentProfile(t);
      setProfile(prof);
      if (prof.isStaff) {
        const ags = await listAgents(t).catch(() => []);
        setAgentsList(ags);
      }
      await loadTasks(t, tab, selectedStaffAgentId);
    } catch (err: any) {
      setError(err?.message || 'Unable to load Agent Portal. Ensure you are signed in as Agent or Operations Staff.');
    } finally {
      setLoading(false);
    }
  };

  const loadTasks = async (t: string, currentTab: 'my' | 'pool' | 'history', agentIdOverride?: string) => {
    try {
      const params: { includeUnassigned?: boolean; agentId?: string } = {};
      if (currentTab === 'pool') {
        params.includeUnassigned = true;
      } else if (agentIdOverride) {
        params.agentId = agentIdOverride;
      }
      const list = await listAgentTasks(params, t);
      setTasks(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch tasks');
    }
  };

  const switchTab = (next: 'my' | 'pool' | 'history') => {
    setTab(next);
    if (token) loadTasks(token, next, selectedStaffAgentId);
  };

  const handleToggleOnline = async () => {
    if (!token) return;
    const targetId = profile?.agent?.id || selectedStaffAgentId;
    if (!targetId) {
      setError('Select an agent profile first');
      return;
    }
    const currentOnline =
      profile?.agent?.isOnline ?? agentsList.find((a) => a.id === targetId)?.isOnline ?? false;
    try {
      const res = await toggleAgentAvailability(!currentOnline, token, targetId);
      if (profile?.agent) {
        setProfile({ ...profile, agent: { ...profile.agent, isOnline: res.isOnline } });
      }
      setAgentsList((prev) => prev.map((a) => (a.id === targetId ? { ...a, isOnline: res.isOnline } : a)));
      setMessage(`Availability set to ${res.isOnline ? 'ONLINE' : 'OFFLINE'}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to toggle availability');
    }
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !scanCode.trim()) return;
    setScanning(true);
    setError(null);
    setMessage(null);
    try {
      const res = await scanBarcodeAsAgent(scanCode.trim(), token);
      if (res.deliveryOtp?.code) {
        setMessage(
          `[${res.awb}] ${res.actionTaken} -> Status: ${res.shipmentStatus}. Delivery OTP: ${res.deliveryOtp.code}`,
        );
      } else {
        setMessage(`[${res.awb}] ${res.actionTaken} -> Status: ${res.shipmentStatus}`);
      }
      setScanCode('');
      await loadTasks(token, tab, selectedStaffAgentId);
    } catch (err: any) {
      setError(err?.message || 'Barcode scan failed');
    } finally {
      setScanning(false);
    }
  };

  const handleAccept = async (taskId: string) => {
    if (!token) return;
    setError(null);
    setMessage(null);
    try {
      await acceptAgentTask(taskId, token, selectedStaffAgentId || undefined);
      setMessage('Task accepted! Added to your active queue.');
      setTab('my');
      await loadTasks(token, 'my', selectedStaffAgentId);
    } catch (err: any) {
      setError(err?.message || 'Failed to accept task');
    }
  };

  const handleConfirmPickup = async (task: HydratedTask) => {
    if (!token) return;
    setError(null);
    setMessage(null);
    try {
      const res = await confirmPickupTask(
        task.id,
        {
          remarks: remarksInputs[task.id] || 'Package verified & collected',
          locationLabel: task.shipment?.pickupAddress?.city || 'Sender Doorstep',
        },
        token,
      );
      setMessage(`Pickup confirmed for ${task.shipment?.awb}! Shipment is now ${res.shipmentStatus}.`);
      await loadTasks(token, tab, selectedStaffAgentId);
    } catch (err: any) {
      setError(err?.message || 'Failed to confirm pickup');
    }
  };

  const handleStartDelivery = async (task: HydratedTask) => {
    if (!token) return;
    setError(null);
    setMessage(null);
    try {
      const res = await startDeliveryTask(task.id, token);
      if (res.deliveryOtp?.code) {
        setMessage(
          `Out for Delivery! Share OTP verification prompt with customer (Dev OTP: ${res.deliveryOtp.code})`,
        );
      } else {
        setMessage(`Shipment ${task.shipment?.awb} is now OUT_FOR_DELIVERY. Customer OTP sent.`);
      }
      await loadTasks(token, tab, selectedStaffAgentId);
    } catch (err: any) {
      setError(err?.message || 'Failed to start delivery');
    }
  };

  const handleConfirmDeliveryOtp = async (task: HydratedTask) => {
    if (!token) return;
    const code = otpInputs[task.id] || '';
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit OTP provided by the recipient');
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await confirmDeliveryTask(task.id, code, token);
      setMessage(`Delivered! AWB ${task.shipment?.awb} confirmed with OTP.`);
      await loadTasks(token, tab, selectedStaffAgentId);
    } catch (err: any) {
      setError(err?.message || 'OTP verification failed');
    }
  };

  const handleConfirmFail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !failModalTask) return;
    setError(null);
    setMessage(null);
    try {
      if (failModalTask.type === 'PICKUP') {
        await failPickupTask(failModalTask.id, { reason: failReason, exceptionCode: failCode }, token);
        setMessage(`Pickup marked FAILED for ${failModalTask.shipment?.awb}.`);
      } else {
        const res = await failDeliveryTask(
          failModalTask.id,
          { reason: failReason, exceptionCode: failCode },
          token,
        );
        if (res.rtoInitiated) {
          setMessage(
            `Delivery failed (Attempt ${res.attempts}). Maximum attempts reached — RTO_INITIATED automatically.`,
          );
        } else {
          setMessage(`Delivery attempt #${res.attempts} recorded as failed.`);
        }
      }
      setFailModalTask(null);
      await loadTasks(token, tab, selectedStaffAgentId);
    } catch (err: any) {
      setError(err?.message || 'Failed to record attempt failure');
    }
  };

  const TERMINAL_SHIPMENT_STATUSES = ['DELIVERED', 'RTO_DELIVERED', 'CANCELLED', 'LOST'];
  const PICKUP_ELIGIBLE_STATUSES = ['BOOKED', 'PICKUP_SCHEDULED', 'PICKUP_FAILED'];
  const DELIVERY_START_STATUSES = ['IN_TRANSIT', 'AT_DESTINATION_HUB', 'DELIVERY_FAILED'];

  const isTaskActionable = (t: HydratedTask) => {
    const shipStatus = t.shipment?.status;
    if (shipStatus && TERMINAL_SHIPMENT_STATUSES.includes(shipStatus)) return false;
    if (t.type === 'PICKUP' && shipStatus && !PICKUP_ELIGIBLE_STATUSES.includes(shipStatus)) {
      return false;
    }
    return true;
  };

  const visibleTasks = tasks.filter((t) => {
    if (tab === 'pool') return !t.agentId && t.status === 'ASSIGNED' && isTaskActionable(t);
    if (tab === 'history') return t.status === 'COMPLETED' || t.status === 'FAILED' || t.status === 'CANCELLED';
    return (t.status === 'ASSIGNED' || t.status === 'ACCEPTED' || t.status === 'IN_PROGRESS') && isTaskActionable(t);
  });

  const activeCount = tasks.filter(
    (t) => ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(t.status) && isTaskActionable(t),
  ).length;
  const completedCount = tasks.filter((t) => t.status === 'COMPLETED').length;

  const effectiveOnline =
    profile?.agent?.isOnline ?? agentsList.find((a) => a.id === selectedStaffAgentId)?.isOnline ?? false;

  if (session.loading) {
    return <div className="py-12 text-center text-xs text-slate-500">Checking session permissions...</div>;
  }
  if (!session.capabilities.canViewAgentPortal) {
    return (
      <AccessRestricted
        roleLabel={session.capabilities.label}
        requiredLabel="Field Agents or Operations Supervisors"
        fallbackHref={session.capabilities.defaultHome}
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Bike className="h-6 w-6 text-indigo-600" />
            Field Courier App (Phase 5 &amp; 6)
          </h1>
          <p className="text-sm text-slate-600">
            {profile?.agent
              ? `Signed in as ${profile.agent.name} (${profile.agent.cityName || 'Operations'})`
              : profile?.isStaff
              ? 'Operations Staff Dispatch & Agent Simulator View'
              : 'Field Courier Pickups, Scans & Doorstep Delivery Handover'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {profile?.isStaff && agentsList.length > 0 && !profile.agent && (
            <select
              value={selectedStaffAgentId}
              onChange={(e) => {
                setSelectedStaffAgentId(e.target.value);
                if (token) loadTasks(token, tab, e.target.value);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
            >
              <option value="">All Agents (Supervisor View)</option>
              {agentsList.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name} ({ag.cityName})
                </option>
              ))}
            </select>
          )}

          {(profile?.agent || selectedStaffAgentId) && (
            <button
              onClick={handleToggleOnline}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                effectiveOnline
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Power className="h-4 w-4" />
              {effectiveOnline ? 'Online' : 'Offline'}
            </button>
          )}

          <button
            onClick={() => token && loadTasks(token, tab, selectedStaffAgentId)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Feedback banners */}
      {message && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{message}</span>
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Quick Barcode Scanner */}
      <form
        onSubmit={handleScan}
        className="mb-6 flex flex-col gap-3 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 sm:flex-row sm:items-center"
      >
        <div className="flex items-center gap-2 text-indigo-900">
          <ScanBarcode className="h-5 w-5 text-indigo-600" />
          <span className="text-sm font-semibold">Quick Barcode / AWB Scan</span>
        </div>
        <div className="flex flex-1 gap-2">
          <input
            type="text"
            value={scanCode}
            onChange={(e) => setScanCode(e.target.value)}
            placeholder="Scan or type AWB / Package Barcode (e.g. BC2611...)"
            className="flex-1 rounded-lg border border-indigo-200 bg-white px-3 py-2 font-mono text-sm uppercase focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={scanning}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {scanning ? 'Scanning...' : 'Process Scan'}
          </button>
        </div>
      </form>

      {/* Stats + Tabs */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3">
        <div className="flex gap-2">
          <button
            onClick={() => switchTab('my')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === 'my' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            Active Queue ({activeCount})
          </button>
          <button
            onClick={() => switchTab('pool')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === 'pool' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            Available City Pool
          </button>
          <button
            onClick={() => switchTab('history')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === 'history' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            Completed / History ({completedCount})
          </button>
        </div>
        <div className="flex gap-3 text-xs text-slate-500">
          <Link href="/hubs" className="text-indigo-600 hover:underline">
            Hub Operations &rarr;
          </Link>
          <Link href="/admin" className="text-indigo-600 hover:underline">
            Admin Desk &rarr;
          </Link>
        </div>
      </div>

      {/* Task List */}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-500">Loading courier tasks...</div>
      ) : visibleTasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Package className="mx-auto mb-2 h-8 w-8 text-slate-400" />
          <p className="text-sm font-medium text-slate-700">No tasks in this view</p>
          <p className="mt-1 text-xs text-slate-500">
            Check &ldquo;Available City Pool&rdquo; to claim new pickups, or assign tasks from the Admin Dispatch desk.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleTasks.map((t) => {
            const addr =
              t.type === 'PICKUP' ? t.shipment?.pickupAddress : t.shipment?.deliveryAddress;
            const isOutForDelivery = t.shipment?.status === 'OUT_FOR_DELIVERY';

            return (
              <div
                key={t.id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          t.type === 'PICKUP'
                            ? 'bg-amber-100 text-amber-800'
                            : t.type === 'DELIVERY'
                            ? 'bg-indigo-100 text-indigo-800'
                            : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {t.type}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        Task: {t.status}
                      </span>
                      {t.shipment && (
                        <Link
                          href={`/track?awb=${t.shipment.awb}`}
                          className="font-mono text-sm font-bold text-indigo-600 hover:underline"
                        >
                          {t.shipment.awb}
                        </Link>
                      )}
                      {t.shipment && (
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          {t.shipment.status}
                        </span>
                      )}
                    </div>

                    {addr ? (
                      <div className="mt-2.5 space-y-1 text-sm text-slate-700">
                        <div className="flex items-center gap-1.5 font-medium">
                          <MapPin className="h-4 w-4 text-slate-400" />
                          {addr.name} &mdash; {addr.line1}, {addr.city} ({addr.pincode})
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" /> {addr.phone}
                          </span>
                          <span>
                            {t.shipment?.bookCount} book(s) &bull; Attempt #{t.attemptNo}
                          </span>
                          {t.agentName && <span>Agent: {t.agentName}</span>}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">Shipment ID: {t.shipmentId}</p>
                    )}

                    {t.shipment?.packages && t.shipment.packages.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {t.shipment.packages.map((p) => (
                          <span
                            key={p.id}
                            className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-600"
                          >
                            {p.barcode} ({p.chargeableWeightKg}kg)
                          </span>
                        ))}
                      </div>
                    )}

                    {t.failureReason && (
                      <div className="mt-2 rounded bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
                        Failure Note: {t.failureReason}
                      </div>
                    )}
                  </div>

                  {/* Action Controls */}
                  {t.status !== 'COMPLETED' &&
                    t.status !== 'CANCELLED' &&
                    t.status !== 'FAILED' &&
                    isTaskActionable(t) && (
                    <div className="flex flex-col items-end gap-2">
                      {(!t.agentId || t.status === 'ASSIGNED') && (
                        <button
                          onClick={() => handleAccept(t.id)}
                          className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                        >
                          {t.agentId ? 'Accept Assigned Task' : 'Claim & Accept Task'}
                        </button>
                      )}

                      {t.type === 'PICKUP' &&
                        t.agentId &&
                        (!t.shipment?.status || PICKUP_ELIGIBLE_STATUSES.includes(t.shipment.status)) && (
                        <div className="flex flex-col items-end gap-2">
                          <input
                            type="text"
                            placeholder="Condition / pickup note"
                            value={remarksInputs[t.id] || ''}
                            onChange={(e) =>
                              setRemarksInputs((p) => ({ ...p, [t.id]: e.target.value }))
                            }
                            className="w-48 rounded-lg border border-slate-300 px-2.5 py-1 text-xs"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleConfirmPickup(t)}
                              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Confirm Pickup
                            </button>
                            <button
                              onClick={() => setFailModalTask(t)}
                              className="flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Fail
                            </button>
                          </div>
                        </div>
                      )}

                      {t.type === 'DELIVERY' &&
                        t.agentId &&
                        t.shipment?.status &&
                        DELIVERY_START_STATUSES.includes(t.shipment.status) && (
                        <button
                          onClick={() => handleStartDelivery(t)}
                          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                        >
                          <Truck className="h-3.5 w-3.5" />
                          Start Delivery (Issue OTP)
                        </button>
                      )}

                      {t.type === 'DELIVERY' && isOutForDelivery && (
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex items-center gap-1.5">
                            <KeyRound className="h-4 w-4 text-emerald-600" />
                            <input
                              type="text"
                              maxLength={6}
                              placeholder="6-digit OTP"
                              value={otpInputs[t.id] || ''}
                              onChange={(e) =>
                                setOtpInputs((p) => ({
                                  ...p,
                                  [t.id]: e.target.value.replace(/\D/g, ''),
                                }))
                              }
                              className="w-28 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-sm tracking-widest"
                            />
                            <button
                              onClick={() => handleConfirmDeliveryOtp(t)}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                            >
                              Deliver
                            </button>
                          </div>
                          <button
                            onClick={() => setFailModalTask(t)}
                            className="text-xs font-medium text-rose-600 hover:underline"
                          >
                            Record Delivery Failure
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Failure Modal */}
      {failModalTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleConfirmFail}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h3 className="text-lg font-bold text-slate-900">
              Report {failModalTask.type} Failure
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              AWB: <span className="font-mono font-semibold">{failModalTask.shipment?.awb}</span>
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Exception Code</label>
                <select
                  value={failCode}
                  onChange={(e) => setFailCode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="RECIPIENT_UNAVAILABLE">Recipient Unavailable</option>
                  <option value="ADDRESS_ISSUE">Address Issue / Incomplete</option>
                  <option value="DELIVERY_REFUSED">Delivery Refused</option>
                  <option value="REATTEMPT_REQUESTED">Reschedule / Reattempt Requested</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Reason Details</label>
                <textarea
                  rows={3}
                  required
                  value={failReason}
                  onChange={(e) => setFailReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFailModalTask(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
              >
                Submit Failure
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

