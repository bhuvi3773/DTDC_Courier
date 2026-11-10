'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  listCarriers,
  toggleCarrier,
  getCurrentStrategy,
  setRoutingStrategy,
  listShipments,
  postShipmentEvent,
  verifyDeliveryOtp,
  resendDeliveryOtp,
  supervisorDeliveryBypass,
  failDelivery,
  listAllTasks,
  listAgents,
  assignTask,
  autoAssignTasks,
  createTask,
  downloadShipmentLabel,
  downloadShipmentInvoice,
  getPricingAdmin,
  upsertPricingRule,
  updatePricingRule,
  deletePricingRule,
  updatePricingConfig,
  listCitiesAdmin,
  createCityAdmin,
  activateCityAdmin,
  suspendCityAdmin,
  upsertPincodeAdmin,
  listTickets,
  getTicket,
  replyTicket,
  updateTicketStatus,
  listExceptions,
  logException,
  acknowledgeFlaggedEvent,
  listNotifications,
  retryNotification,
  getAdminDashboard,
  getAnalyticsReport,
  getFinanceLedger,
  downloadShipmentsCsv,
  listStaffUsers,
  createStaffUser,
  setUserActiveStatus,
  Carrier,
  HydratedTask,
  AgentSummary,
  PricingRuleDTO,
  PricingConfigDTO,
  AdminCityDTO,
  TicketSummaryDTO,
  TicketDetailDTO,
  ExceptionQueueDTO,
  NotificationDTO,
  AdminDashboardDTO,
  AnalyticsReportDTO,
  FinanceLedgerDTO,
  StaffUserDTO,
} from '@/lib/api';
import { useAuthSession } from '@/hooks/useAuthSession';
import { AccessRestricted } from '@/components/AccessRestricted';
import { AdminTabId, RoleCapabilities } from '@/lib/rbac';
import { PasswordInput } from '@/components/PasswordInput';
import {
  AdminBulkCsvTools,
  AdminCodSettlementPanel,
  AdminEnterpriseTab,
  AdminGovernanceTab,
} from '@/components/AdminEnterprisePanels';
import {
  Settings,
  Truck,
  ShieldCheck,
  RefreshCw,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sliders,
  Send,
  Users,
  Warehouse,
  Bike,
  Sparkles,
  Printer,
  IndianRupee,
  MapPinned,
  Trash2,
  LifeBuoy,
  Bell,
  MessageSquare,
  BarChart3,
  Download,
  FileText,
  Building2,
  ScrollText,
} from 'lucide-react';

export default function AdminPage() {
  const session = useAuthSession({ redirectIfUnauth: true });
  const token = session.token;
  const caps = session.capabilities;

  // Strategy & Carriers
  const [strategy, setStrategy] = useState<string>('AUTO_OPTIMIZED');
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [carrierLoading, setCarrierLoading] = useState(false);

  // Shipments & Operations (Phase 7)
  const [shipments, setShipments] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loadingShipments, setLoadingShipments] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Tasks & Agents (Phase 5)
  const [tasks, setTasks] = useState<HydratedTask[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);

  // Staff & Employee Users (SUPER_ADMIN only)
  const [staffUsers, setStaffUsers] = useState<StaffUserDTO[]>([]);
  const [newStaff, setNewStaff] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    role: 'AGENT',
  });

  // Admin Console Tab
  const [adminTab, setAdminTab] = useState<AdminTabId>('ops');

  // Phase 9: Dashboard, Analytics & Finance State
  const [dashboardKpi, setDashboardKpi] = useState<AdminDashboardDTO | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsReportDTO | null>(null);
  const [financeLedger, setFinanceLedger] = useState<FinanceLedgerDTO | null>(null);
  const [reportFilter, setReportFilter] = useState({ from: '', to: '', carrierType: '' });

  // Phase 8: Tickets, Exceptions & Notifications State
  const [adminTickets, setAdminTickets] = useState<TicketSummaryDTO[]>([]);
  const [activeTicket, setActiveTicket] = useState<TicketDetailDTO | null>(null);
  const [ticketReply, setTicketReply] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [claimRefundAmt, setClaimRefundAmt] = useState('');
  const [exceptionQueue, setExceptionQueue] = useState<ExceptionQueueDTO | null>(null);
  const [newExc, setNewExc] = useState({ awb: '', code: 'DELAYED', remarks: '', markLost: false });
  const [adminNotifs, setAdminNotifs] = useState<NotificationDTO[]>([]);

  // Phase 4: Pricing Config, Rules & Serviceability State
  const [pricingConfig, setPricingConfig] = useState<PricingConfigDTO | null>(null);
  const [pricingRules, setPricingRules] = useState<PricingRuleDTO[]>([]);
  const [cities, setCities] = useState<AdminCityDTO[]>([]);
  const [newRule, setNewRule] = useState<{
    originZone: string;
    destZone: string;
    serviceType: PricingRuleDTO['serviceType'];
    maxWeightKg: number;
    price: number;
    etaDays: number;
  }>({
    originZone: 'BENGALURU-S',
    destZone: 'CHENNAI-C',
    serviceType: 'INTERCITY',
    maxWeightKg: 5,
    price: 279,
    etaDays: 3,
  });
  const [newCity, setNewCity] = useState({ name: '', state: '' });
  const [newPincode, setNewPincode] = useState({
    pincode: '',
    cityId: '',
    zone: '',
    ownPickup: true,
    ownDelivery: true,
    partnerServiceable: true,
  });

  // OTP Verification modal / row state
  const [actionShipmentId, setActionShipmentId] = useState<string | null>(null);
  const [otpInputs, setOtpInputs] = useState<Record<string, string>>({});
  const [bypassReason, setBypassReason] = useState('');
  const [bypassProofUrl, setBypassProofUrl] = useState('');
  const [showBypassModalFor, setShowBypassModalFor] = useState<string | null>(null);

  useEffect(() => {
    if (session.loading || !session.token) return;
    if (!caps.canViewAdminConsole) {
      setCarrierLoading(false);
      return;
    }
    if (typeof window !== 'undefined') {
      const qTab = new URLSearchParams(window.location.search).get('tab') as AdminTabId | null;
      if (qTab && caps.adminTabs.includes(qTab)) {
        setAdminTab(qTab);
      } else if (caps.adminTabs.length > 0 && !caps.adminTabs.includes(adminTab)) {
        setAdminTab(caps.adminTabs[0]);
      }
    }
    loadAll(session.token, caps);
  }, [session.loading, session.token, caps.role]);

  const loadAll = async (t: string, c: RoleCapabilities = caps) => {
    setCarrierLoading(true);
    setError(null);
    try {
      const [
        strat,
        carrs,
        ships,
        tsks,
        ags,
        pricingAdmin,
        citiesAdmin,
        tksAdmin,
        excsAdmin,
        notifsAdmin,
        kpiAdmin,
        repAdmin,
        finAdmin,
        usersAdmin,
      ] = await Promise.all([
        c.canManageRoutingAndCarriers || c.adminTabs.includes('ops')
          ? getCurrentStrategy(t).catch(() => ({ strategy: 'AUTO_OPTIMIZED' }))
          : Promise.resolve({ strategy: 'AUTO_OPTIMIZED' }),
        c.canViewCarriers ? listCarriers(t).catch(() => []) : Promise.resolve([]),
        c.adminTabs.includes('ops') ? listShipments({}, t).catch(() => []) : Promise.resolve([]),
        c.canManageTasks ? listAllTasks({}, t).catch(() => []) : Promise.resolve([]),
        c.canManageTasks ? listAgents(t).catch(() => []) : Promise.resolve([]),
        c.adminTabs.includes('pricing') ? getPricingAdmin(t).catch(() => null) : Promise.resolve(null),
        c.adminTabs.includes('pricing') ? listCitiesAdmin(t).catch(() => []) : Promise.resolve([]),
        c.canManageTickets ? listTickets({}, t).catch(() => []) : Promise.resolve([]),
        c.canManageExceptions ? listExceptions(t).catch(() => null) : Promise.resolve(null),
        c.canViewNotifications ? listNotifications({}, t).catch(() => []) : Promise.resolve([]),
        c.canViewDashboardKpi ? getAdminDashboard(t).catch(() => null) : Promise.resolve(null),
        c.canViewAnalytics ? getAnalyticsReport(reportFilter, t).catch(() => null) : Promise.resolve(null),
        c.canViewFinanceLedger ? getFinanceLedger(t).catch(() => null) : Promise.resolve(null),
        c.tier === 'SUPER_ADMIN' ? listStaffUsers(t).catch(() => []) : Promise.resolve([]),
      ]);
      setStrategy(strat.strategy);
      setCarriers(carrs);
      setShipments(ships);
      setTasks(tsks);
      setAgents(ags);
      setAdminTickets(tksAdmin);
      setExceptionQueue(excsAdmin);
      setAdminNotifs(notifsAdmin);
      setDashboardKpi(kpiAdmin);
      setAnalytics(repAdmin);
      setFinanceLedger(finAdmin);
      setStaffUsers(usersAdmin);
      if (pricingAdmin) {
        setPricingConfig(pricingAdmin.config);
        setPricingRules(pricingAdmin.rules);
      }
      setCities(citiesAdmin);
      if (citiesAdmin.length > 0 && !newPincode.cityId) {
        setNewPincode((p) => ({ ...p, cityId: citiesAdmin[0].id }));
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load admin console data');
    } finally {
      setCarrierLoading(false);
    }
  };

  // Phase 5: Auto-assign unassigned tasks
  const handleAutoAssign = async () => {
    if (!token) return;
    setError(null);
    setMessage(null);
    try {
      const res = await autoAssignTasks(token);
      setMessage(`Auto-assigned ${res.assignedCount} task(s) to online agents.`);
      await loadAll(token);
    } catch (err: any) {
      setError(err?.message || 'Auto-assign failed');
    }
  };

  // Phase 5: Manual task assignment
  const handleAssignAgent = async (taskId: string, agentId: string) => {
    if (!token || !agentId) return;
    setError(null);
    setMessage(null);
    try {
      await assignTask(taskId, agentId, token);
      setMessage('Agent assigned to task.');
      await loadAll(token);
    } catch (err: any) {
      setError(err?.message || 'Failed to assign agent');
    }
  };

  // Phase 5: Create & dispatch Delivery Task
  const handleCreateTask = async (type: 'PICKUP' | 'DELIVERY', shipmentId: string, dispatchNow = false) => {
    if (!token) return;
    setError(null);
    setMessage(null);
    try {
      const defaultAgentId = agents.find((a) => a.isOnline)?.id || agents[0]?.id;
      const res = await createTask(
        { type, shipmentId, agentId: defaultAgentId, dispatchNow },
        token,
      );
      if (res.deliveryOtp?.code) {
        setMessage(`${type} task created & dispatched! Customer OTP: ${res.deliveryOtp.code}`);
      } else {
        setMessage(`${type} task created!`);
      }
      await loadAll(token);
    } catch (err: any) {
      setError(err?.message || `Failed to create ${type} task`);
    }
  };

  // Phase 4: Pricing Config & Rules Handlers
  const handleSavePricingConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !pricingConfig) return;
    setError(null);
    setMessage(null);
    try {
      const updated = await updatePricingConfig(pricingConfig, token);
      setPricingConfig(updated);
      setMessage('Global pricing configuration & surcharges updated!');
    } catch (err: any) {
      setError(err?.message || 'Failed to update pricing configuration');
    }
  };

  const handleAddPricingRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setMessage(null);
    try {
      await upsertPricingRule({ ...newRule, isActive: true }, token);
      setMessage(`Pricing slab ${newRule.originZone} -> ${newRule.destZone} saved!`);
      await loadAll(token);
    } catch (err: any) {
      setError(err?.message || 'Failed to save pricing rule');
    }
  };

  const handleToggleRuleActive = async (rule: PricingRuleDTO) => {
    if (!token) return;
    setError(null);
    try {
      await updatePricingRule(rule.id, { isActive: !rule.isActive }, token);
      setPricingRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, isActive: !r.isActive } : r)),
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to toggle pricing rule');
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!token) return;
    setError(null);
    try {
      await deletePricingRule(ruleId, token);
      setPricingRules((prev) => prev.filter((r) => r.id !== ruleId));
      setMessage('Pricing rule deleted');
    } catch (err: any) {
      setError(err?.message || 'Failed to delete pricing rule');
    }
  };

  const handleCreateCity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newCity.name || !newCity.state) return;
    setError(null);
    try {
      await createCityAdmin(newCity, token);
      setNewCity({ name: '', state: '' });
      setMessage('City registered (INACTIVE until prerequisites are met).');
      await loadAll(token);
    } catch (err: any) {
      setError(err?.message || 'Failed to add city');
    }
  };

  const handleActivateCity = async (city: AdminCityDTO) => {
    if (!token) return;
    setError(null);
    setMessage(null);
    try {
      await activateCityAdmin(city.id, token);
      setMessage(`${city.name} is now ACTIVE for own-network fulfillment!`);
      await loadAll(token);
    } catch (err: any) {
      setError(err?.message || 'Failed to activate city');
    }
  };

  const handleSuspendCity = async (city: AdminCityDTO) => {
    if (!token) return;
    setError(null);
    try {
      await suspendCityAdmin(city.id, token);
      setMessage(`${city.name} suspended (INACTIVE).`);
      await loadAll(token);
    } catch (err: any) {
      setError(err?.message || 'Failed to suspend city');
    }
  };

  const handleUpsertPincode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newPincode.pincode || !newPincode.cityId || !newPincode.zone) return;
    setError(null);
    try {
      await upsertPincodeAdmin(newPincode, token);
      setMessage(`Pincode ${newPincode.pincode} (${newPincode.zone}) saved!`);
      setNewPincode((p) => ({ ...p, pincode: '' }));
      await loadAll(token);
    } catch (err: any) {
      setError(err?.message || 'Failed to save pincode');
    }
  };

  const handleStrategyChange = async (newStrategy: string) => {
    if (!token) return;
    try {
      await setRoutingStrategy(newStrategy, token);
      setStrategy(newStrategy);
      setMessage(`Global routing strategy set to ${newStrategy}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to update routing strategy');
    }
  };

  const handleCarrierToggle = async (carrierId: string, currentStatus: boolean) => {
    if (!token) return;
    try {
      await toggleCarrier(carrierId, !currentStatus, token);
      setCarriers((prev) =>
        prev.map((c) => (c.id === carrierId ? { ...c, isEnabled: !currentStatus } : c)),
      );
      setMessage('Carrier status updated');
    } catch (err: any) {
      setError(err?.message || 'Failed to toggle carrier');
    }
  };

  // Phase 7: Trigger Out for Delivery (issues Delivery OTP)
  const handleDispatchOutForDelivery = async (shipmentId: string) => {
    if (!token) return;
    setError(null);
    setMessage(null);
    try {
      const res = await postShipmentEvent(
        shipmentId,
        {
          status: 'OUT_FOR_DELIVERY',
          kind: 'STATUS',
          remarks: 'Dispatched from local hub for last-mile delivery',
        },
        token,
      );
      if (res.deliveryOtp?.code) {
        setMessage(`Shipment marked OUT_FOR_DELIVERY. OTP generated: ${res.deliveryOtp.code} (Dev/SMS)`);
      } else {
        setMessage('Shipment marked OUT_FOR_DELIVERY. Recipient OTP dispatched.');
      }
      loadAll(token);
    } catch (err: any) {
      setError(err?.message || 'Failed to update status to OUT_FOR_DELIVERY');
    }
  };

  // Phase 7: Verify Delivery OTP
  const handleVerifyOtp = async (shipmentId: string) => {
    if (!token) return;
    const code = otpInputs[shipmentId];
    if (!code || code.length !== 6) {
      setError('Please provide a 6-digit code');
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await verifyDeliveryOtp(shipmentId, code, token);
      setMessage(`Delivery verified and confirmed DELIVERED!`);
      loadAll(token);
    } catch (err: any) {
      setError(err?.message || 'OTP verification failed');
    }
  };

  // Phase 7: Resend Delivery OTP
  const handleResendOtp = async (shipmentId: string) => {
    if (!token) return;
    setError(null);
    setMessage(null);
    try {
      const res = await resendDeliveryOtp(shipmentId, token);
      if (res.code) {
        setMessage(`Fresh OTP issued: ${res.code} (Dev/SMS)`);
      } else {
        setMessage('Fresh delivery OTP sent to recipient.');
      }
    } catch (err: any) {
      setError(err?.message || 'Could not resend OTP (check 60s cooldown)');
    }
  };

  // Phase 7: Supervisor Exception Override
  const handleSupervisorBypass = async (shipmentId: string) => {
    if (!token || !bypassReason.trim()) {
      setError('A mandatory reason is required for supervisor bypass.');
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await supervisorDeliveryBypass(shipmentId, bypassReason.trim(), bypassProofUrl || undefined, token);
      setMessage('Supervisor bypass applied. Marked DELIVERED with audit log entry.');
      setShowBypassModalFor(null);
      setBypassReason('');
      setBypassProofUrl('');
      loadAll(token);
    } catch (err: any) {
      setError(err?.message || 'Supervisor bypass failed');
    }
  };

  // Phase 7: Record Delivery Failed
  const handleDeliveryFailed = async (shipmentId: string) => {
    if (!token) return;
    setError(null);
    setMessage(null);
    try {
      const res = await failDelivery(
        shipmentId,
        'Recipient unavailable at delivery address',
        'RECIPIENT_UNAVAILABLE',
        token,
      );
      if (res.rtoInitiated) {
        setMessage(`Delivery attempt failed (${res.attempts}/3). Maximum attempts exceeded — Return to Origin (RTO) initiated!`);
      } else {
        setMessage(`Delivery attempt marked failed (${res.attempts}/3). Re-attempt scheduled.`);
      }
      loadAll(token);
    } catch (err: any) {
      setError(err?.message || 'Failed to record delivery failure');
    }
  };

  const filteredShipments = shipments.filter((s) =>
    statusFilter ? s.status === statusFilter : true,
  );

  if (session.loading) {
    return <div className="py-12 text-center text-xs text-slate-500">Checking session permissions...</div>;
  }
  if (!caps.canViewAdminConsole) {
    return (
      <AccessRestricted
        roleLabel={caps.label}
        requiredLabel="Operations, Support, Finance, or Super Admin Staff"
        fallbackHref={caps.defaultHome}
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Title */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Operations & Logistics <span className="text-brand-600">Control Desk</span>
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Signed in as <span className="font-semibold text-slate-700">{caps.label}</span> &bull; Scoped management workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {caps.canViewAgentPortal && (
            <Link
              href="/agent"
              className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              <Bike className="h-3.5 w-3.5" /> Field Agent App
            </Link>
          )}
          {caps.canManageHubsAndManifests && (
            <Link
              href="/hubs"
              className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              <Warehouse className="h-3.5 w-3.5" /> Hub Ops &amp; Manifests
            </Link>
          )}
          <button
            onClick={() => token && loadAll(token, caps)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Notifications */}
      {message && (
        <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-xs font-semibold text-emerald-800 border border-emerald-200">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {/* Live KPI Summary Strip (Phase 9) */}
      {caps.canViewDashboardKpi && dashboardKpi && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {[
            { label: 'Booked Today', value: dashboardKpi.bookedToday, cls: 'text-slate-900', fin: false },
            { label: 'Pending Pickups', value: dashboardKpi.pendingPickups, cls: 'text-amber-700', fin: false },
            { label: 'In Transit', value: dashboardKpi.inTransit, cls: 'text-indigo-700', fin: false },
            { label: 'Delivered', value: dashboardKpi.delivered, cls: 'text-emerald-700', fin: false },
            { label: 'Open Tickets', value: dashboardKpi.openTickets, cls: 'text-rose-700', fin: false },
            { label: 'Revenue (Paid)', value: `₹${dashboardKpi.revenue.toFixed(0)}`, cls: 'text-slate-900 font-mono', fin: true },
            { label: 'Net Margin', value: `₹${dashboardKpi.netMargin.toFixed(0)}`, cls: 'text-emerald-700 font-mono', fin: true },
          ]
            .filter((k) => !k.fin || caps.canViewFinancialMetrics)
            .map((k) => (
              <div key={k.label} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{k.label}</p>
                <p className={`mt-0.5 text-lg font-bold ${k.cls}`}>{k.value}</p>
              </div>
            ))}
        </div>
      )}

      {/* Console Tab Bar */}
      <div className="mt-6 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {caps.adminTabs.includes('ops') && (
          <button
            type="button"
            onClick={() => setAdminTab('ops')}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition ${
              adminTab === 'ops'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Settings className="h-3.5 w-3.5" />
            Operations, Routing &amp; Dispatch
          </button>
        )}
        {caps.adminTabs.includes('pricing') && (
          <button
            type="button"
            onClick={() => setAdminTab('pricing')}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition ${
              adminTab === 'pricing'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <IndianRupee className="h-3.5 w-3.5" />
            Pricing &amp; Serviceability ({pricingRules.length} rules / {cities.length} cities)
          </button>
        )}
        {caps.adminTabs.includes('phase8') && (
          <button
            type="button"
            onClick={() => setAdminTab('phase8')}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition ${
              adminTab === 'phase8'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <LifeBuoy className="h-3.5 w-3.5" />
            Support, Exceptions &amp; Alerts{caps.canManageTickets ? ` (${adminTickets.filter((t) => t.status === 'OPEN').length} open)` : ''}
          </button>
        )}
        {caps.adminTabs.includes('phase9') && (
          <button
            type="button"
            onClick={() => setAdminTab('phase9')}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition ${
              adminTab === 'phase9'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Analytics, COD &amp; Reports
          </button>
        )}
        {caps.adminTabs.includes('enterprise') && (
          <button
            type="button"
            onClick={() => setAdminTab('enterprise')}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition ${
              adminTab === 'enterprise'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            Promos, B2B &amp; Network
          </button>
        )}
        {caps.adminTabs.includes('governance') && (
          <button
            type="button"
            onClick={() => setAdminTab('governance')}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition ${
              adminTab === 'governance'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <ScrollText className="h-3.5 w-3.5" />
            Audit, Webhooks &amp; Config
          </button>
        )}
      </div>

      {adminTab === 'ops' && (
      <>
      {/* Section 1: Carrier Mode Switch & Toggles */}
      {(caps.canManageRoutingAndCarriers || caps.canViewCarriers) && (
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {/* Global Strategy Switch */}
        {caps.canManageRoutingAndCarriers && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-brand-600" />
            <h2 className="text-sm font-bold text-slate-800">Global Routing Strategy</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Instantly controls how quotes and bookings route between Own Fleet and Partner couriers.
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { id: 'AUTO_OPTIMIZED', label: 'Auto (Best)' },
              { id: 'OWN_ONLY', label: 'Own Fleet Only' },
              { id: 'PARTNER_ONLY', label: 'Partner Only' },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleStrategyChange(s.id)}
                className={`rounded-lg py-2 text-xs font-semibold transition border ${
                  strategy === s.id
                    ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* Carrier Toggles */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-brand-600" />
            <h2 className="text-sm font-bold text-slate-800">Carrier Partners & Internal Fleet</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {caps.canManageRoutingAndCarriers
              ? 'Enable or disable individual providers across all customer quote engines.'
              : 'Active carrier providers (read-only for your role).'}
          </p>

          <div className="mt-4 space-y-2">
            {carriers.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
              >
                <div>
                  <span className="font-semibold text-slate-800">{c.name}</span>
                  <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                    {c.code}
                  </span>
                </div>
                {caps.canManageRoutingAndCarriers ? (
                  <button
                    type="button"
                    onClick={() => handleCarrierToggle(c.id, c.isEnabled)}
                    className={`rounded-full px-3 py-0.5 text-xs font-semibold ${
                      c.isEnabled
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                        : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                    }`}
                  >
                    {c.isEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                ) : (
                  <span
                    className={`rounded-full px-3 py-0.5 text-xs font-semibold ${
                      c.isEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {c.isEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* Section 2: Phase 7 Delivery Operations & OTP Verification Console */}
      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-brand-600" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Phase 7: Last-Mile Delivery & OTP Handover Desk
              </h2>
              <p className="text-xs text-slate-500">
                Monitor field shipments, dispatch last mile, verify recipient OTPs, and apply supervisor overrides.
              </p>
            </div>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-slate-500">Filter:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs focus:outline-none"
            >
              <option value="">All Statuses ({shipments.length})</option>
              <option value="OUT_FOR_DELIVERY">Out for Delivery</option>
              <option value="BOOKED">Booked</option>
              <option value="DELIVERED">Delivered</option>
              <option value="DELIVERY_FAILED">Delivery Failed</option>
            </select>
          </div>
        </div>

        {/* Shipment Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5">AWB & Type</th>
                <th className="px-3 py-2.5">Service</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Payment</th>
                <th className="px-3 py-2.5">Operational Actions (Phase 7)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredShipments.map((s) => {
                const isOFD = s.status === 'OUT_FOR_DELIVERY';
                const isDelivered = s.status === 'DELIVERED';
                const isFailed = s.status === 'DELIVERY_FAILED';

                return (
                  <tr key={s.id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-3">
                      <p className="font-mono font-bold text-slate-900">{s.awb}</p>
                      <p className="text-[10px] text-slate-500">
                        {s.shipmentType === 'BOOKSTORE_ORDER_SHIPMENT' ? 'Courier Dispatch' : 'Personal Courier'}
                      </p>
                    </td>

                    <td className="px-3 py-3">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                        {s.serviceType}
                      </span>
                    </td>

                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          isDelivered
                            ? 'bg-emerald-100 text-emerald-800'
                            : isOFD
                            ? 'bg-amber-100 text-amber-800'
                            : isFailed
                            ? 'bg-red-100 text-red-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {isDelivered && <CheckCircle2 className="h-3 w-3" />}
                        {isOFD && <Truck className="h-3 w-3" />}
                        {isFailed && <AlertTriangle className="h-3 w-3" />}
                        {s.status.replace(/_/g, ' ')}
                      </span>
                    </td>

                    <td className="px-3 py-3">
                      <span
                        className={`text-[10px] font-semibold ${
                          s.paymentStatus === 'PAID' ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        {s.paymentStatus}
                      </span>
                    </td>

                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            token &&
                            downloadShipmentLabel(s.id, s.awb, token).catch((e) =>
                              setError(e?.message || 'Failed to generate PDF label'),
                            )
                          }
                          className="flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                          title="Download Printable Label PDF"
                        >
                          <Printer className="h-3 w-3" /> Label
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            token &&
                            downloadShipmentInvoice(s.id, s.awb, token).catch((e) =>
                              setError(e?.message || 'Failed to generate Tax Invoice PDF'),
                            )
                          }
                          className="flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                          title="Download Sequential GST Tax Invoice PDF"
                        >
                          <FileText className="h-3 w-3" /> Invoice
                        </button>

                        {/* Create Pickup Task for new bookings */}
                        {['BOOKED', 'PICKUP_FAILED'].includes(s.status) && (
                          <button
                            type="button"
                            onClick={() => handleCreateTask('PICKUP', s.id)}
                            className="rounded border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                          >
                            + Assign Pickup
                          </button>
                        )}

                        {/* 1. Dispatch out for delivery when ready at hub/in-transit */}
                        {['IN_TRANSIT', 'AT_DESTINATION_HUB', 'DELIVERY_FAILED'].includes(s.status) && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleCreateTask('DELIVERY', s.id, true)}
                              className="flex items-center gap-1 rounded bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-900"
                            >
                              <Send className="h-3 w-3" /> Dispatch OFD
                            </button>
                          </>
                        )}

                        {/* 2. Verification actions when in OUT_FOR_DELIVERY */}
                        {isOFD && (
                          <>
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                maxLength={6}
                                value={otpInputs[s.id] || ''}
                                onChange={(e) =>
                                  setOtpInputs({
                                    ...otpInputs,
                                    [s.id]: e.target.value.replace(/\D/g, ''),
                                  })
                                }
                                placeholder="6-digit OTP"
                                className="w-24 rounded border border-slate-300 px-2 py-1 text-center font-mono text-xs focus:border-brand-600 focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleVerifyOtp(s.id)}
                                className="rounded bg-brand-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand-700"
                              >
                                Verify & Deliver
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleResendOtp(s.id)}
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                              title="Resend Delivery OTP"
                            >
                              <RefreshCw className="h-3 w-3" />
                            </button>

                            {caps.canBypassDeliveryOtp && (
                              <button
                                type="button"
                                onClick={() => setShowBypassModalFor(s.id)}
                                className="rounded bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-800 hover:bg-amber-200"
                                title="Supervisor Override Bypass"
                              >
                                Bypass
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleDeliveryFailed(s.id)}
                              className="rounded bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100"
                              title="Record delivery failed"
                            >
                              Fail
                            </button>
                          </>
                        )}

                        {isDelivered && (
                          <span className="text-[11px] text-slate-400">Handover Complete</span>
                        )}
                      </div>

                      {/* Supervisor Override Modal Dialog */}
                      {showBypassModalFor === s.id && (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                          <p className="text-[11px] font-bold text-amber-900">
                            Supervisor Exception Delivery Bypass
                          </p>
                          <input
                            type="text"
                            value={bypassReason}
                            onChange={(e) => setBypassReason(e.target.value)}
                            placeholder="Mandatory Reason (e.g. Recipient phone offline; photo proof verified)"
                            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                          />
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={bypassProofUrl}
                              onChange={(e) => setBypassProofUrl(e.target.value)}
                              placeholder="Optional Proof URL"
                              className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => handleSupervisorBypass(s.id)}
                              className="rounded bg-amber-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-amber-700"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowBypassModalFor(null)}
                              className="rounded border border-slate-300 px-2 py-1 text-[11px]"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredShipments.length === 0 && (
            <div className="py-8 text-center text-xs text-slate-500">
              No shipments found matching the selected filter.
            </div>
          )}
        </div>
      </div>

      {/* Section 3: Phase 5 Field Agent Dispatch & Task Board */}
      {caps.canManageTasks && (
      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Phase 5: Field Agent Dispatch &amp; Task Assignment
              </h2>
              <p className="text-xs text-slate-500">
                {agents.filter((a) => a.isOnline).length}/{agents.length} agents online &bull; Auto-assign or manually dispatch pickup and delivery tasks.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleAutoAssign}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Auto-Assign Unassigned Tasks
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5">Task Type</th>
                <th className="px-3 py-2.5">Shipment AWB</th>
                <th className="px-3 py-2.5">Task Status</th>
                <th className="px-3 py-2.5">Assigned Agent</th>
                <th className="px-3 py-2.5">Reassign Agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/80">
                  <td className="px-3 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        t.type === 'PICKUP'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-indigo-100 text-indigo-800'
                      }`}
                    >
                      {t.type}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/track?awb=${t.shipment?.awb || ''}`}
                      className="font-mono font-semibold text-indigo-600 hover:underline"
                    >
                      {t.shipment?.awb || t.shipmentId.slice(0, 8)}
                    </Link>
                    <p className="text-[10px] text-slate-500">{t.shipment?.status}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                      {t.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {t.agentName ? (
                      <span className="font-medium">{t.agentName}</span>
                    ) : (
                      <span className="text-amber-600 italic">Unassigned</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {t.status !== 'COMPLETED' && t.status !== 'CANCELLED' ? (
                      <select
                        value={t.agentId || ''}
                        onChange={(e) => handleAssignAgent(t.id, e.target.value)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        <option value="">-- Select Agent --</option>
                        {agents.map((ag) => (
                          <option key={ag.id} value={ag.id}>
                            {ag.name} ({ag.cityName}) {ag.isOnline ? '●' : '○'} [{ag.activeTaskCount}]
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[10px] text-slate-400">Closed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {tasks.length === 0 && (
            <div className="py-6 text-center text-xs text-slate-500">
              No operational tasks yet. Tasks auto-create when an own-fleet shipment is paid, or assign manually above.
            </div>
          )}
        </div>
      </div>
      )}

      {/* Section 4: Staff & Employee Account Provisioning (SUPER_ADMIN only) */}
      {caps.tier === 'SUPER_ADMIN' && (
      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-slate-900" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Staff, Employee &amp; User Accounts ({staffUsers.length})
              </h2>
              <p className="text-xs text-slate-500">
                Create Employee / Agent / Manager accounts with Email + Password login or toggle active access.
              </p>
            </div>
          </div>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!token) return;
            setError(null);
            try {
              await createStaffUser(
                {
                  name: newStaff.name.trim(),
                  email: newStaff.email.trim(),
                  phone: newStaff.phone.trim() || undefined,
                  password: newStaff.password,
                  role: newStaff.role,
                },
                token,
              );
              setMessage(`Created ${newStaff.role} account for ${newStaff.email}`);
              setNewStaff({ name: '', email: '', phone: '', password: '', role: 'AGENT' });
              await loadAll(token, caps);
            } catch (err: any) {
              setError(err?.message || 'Failed to create staff account');
            }
          }}
          className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-6 text-xs"
        >
          <input
            type="text"
            placeholder="Full Name"
            required
            value={newStaff.name}
            onChange={(e) => setNewStaff((p) => ({ ...p, name: e.target.value }))}
            className="rounded border border-slate-300 bg-white px-2.5 py-2"
          />
          <input
            type="email"
            placeholder="Email Address"
            required
            value={newStaff.email}
            onChange={(e) => setNewStaff((p) => ({ ...p, email: e.target.value }))}
            className="rounded border border-slate-300 bg-white px-2.5 py-2"
          />
          <input
            type="tel"
            placeholder="Phone (optional)"
            value={newStaff.phone}
            onChange={(e) => setNewStaff((p) => ({ ...p, phone: e.target.value }))}
            className="rounded border border-slate-300 bg-white px-2.5 py-2"
          />
          <div>
            <PasswordInput
              value={newStaff.password}
              onChange={(v) => setNewStaff((p) => ({ ...p, password: v }))}
              placeholder="Password (8+)"
              minLength={8}
              required
            />
          </div>
          <select
            value={newStaff.role}
            onChange={(e) => setNewStaff((p) => ({ ...p, role: e.target.value }))}
            className="rounded border border-slate-300 bg-white px-2.5 py-2"
          >
            {['AGENT', 'HUB_MANAGER', 'SUPERVISOR', 'SUPPORT', 'FINANCE', 'CITY_MANAGER', 'OPS_MANAGER', 'SUPER_ADMIN'].map(
              (r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ),
            )}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white hover:bg-slate-800"
          >
            + Create Employee
          </button>
        </form>

        <div className="mt-4 overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email / Phone</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Verified / Pass</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staffUsers.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2 font-semibold text-slate-900">{u.name}</td>
                  <td className="px-3 py-2 text-slate-600">
                    <div>{u.email || '—'}</div>
                    <div className="text-[10px] text-slate-400">{u.phone || ''}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                      {u.role}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-slate-500">
                    {u.isEmailVerified ? 'Email Verified' : 'Unverified'} &bull;{' '}
                    {u.hasPassword ? 'Password Set' : 'OTP Only'}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!token) return;
                        setError(null);
                        try {
                          await setUserActiveStatus(u.id, !u.isActive, token);
                          await loadAll(token, caps);
                        } catch (err: any) {
                          setError(err?.message || 'Failed to update status');
                        }
                      }}
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                        u.isActive
                          ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                          : 'bg-red-100 text-red-700 hover:bg-red-200'
                      }`}
                    >
                      {u.isActive ? 'Active' : 'Disabled'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
      </>
      )}

      {/* Phase 4 Tab: Pricing Config, Zone Rate Rules & Serviceability */}
      {adminTab === 'pricing' && (
        <div className="mt-6 space-y-8">
          {/* 1. Global Pricing Fees & Parameters */}
          {pricingConfig && (
            <form
              onSubmit={handleSavePricingConfig}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <IndianRupee className="h-5 w-5 text-brand-600" />
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Global Pricing Parameters &amp; Fees</h2>
                    <p className="text-xs text-slate-500">
                      Applied dynamically across every live quote and booking calculation.
                    </p>
                  </div>
                </div>
                <button
                  type="submit"
                  className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
                >
                  Save Global Fees
                </button>
              </div>

              <div className="mt-4 grid gap-4 text-xs sm:grid-cols-4">
                <div>
                  <label className="block font-medium text-slate-700">Pickup Fee (₹)</label>
                  <input
                    type="number"
                    step="1"
                    value={pricingConfig.pickupFee}
                    onChange={(e) => setPricingConfig({ ...pricingConfig, pickupFee: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Standard Packaging Fee (₹)</label>
                  <input
                    type="number"
                    step="1"
                    value={pricingConfig.packagingFee}
                    onChange={(e) => setPricingConfig({ ...pricingConfig, packagingFee: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Fragile Packaging Fee (₹)</label>
                  <input
                    type="number"
                    step="1"
                    value={pricingConfig.fragilePackagingFee}
                    onChange={(e) =>
                      setPricingConfig({ ...pricingConfig, fragilePackagingFee: Number(e.target.value) })
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Service Surcharge (₹)</label>
                  <input
                    type="number"
                    step="1"
                    value={pricingConfig.serviceSurcharge}
                    onChange={(e) =>
                      setPricingConfig({ ...pricingConfig, serviceSurcharge: Number(e.target.value) })
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Volumetric Divisor</label>
                  <input
                    type="number"
                    step="100"
                    value={pricingConfig.volumetricDivisor}
                    onChange={(e) =>
                      setPricingConfig({ ...pricingConfig, volumetricDivisor: Number(e.target.value) })
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Weight Step (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={pricingConfig.weightStepKg}
                    onChange={(e) =>
                      setPricingConfig({ ...pricingConfig, weightStepKg: Number(e.target.value) })
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">GST Tax Rate (0.18 = 18%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={pricingConfig.taxRate}
                    onChange={(e) => setPricingConfig({ ...pricingConfig, taxRate: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Protection Rate (0.01 = 1%)</label>
                  <input
                    type="number"
                    step="0.005"
                    value={pricingConfig.protectionRate}
                    onChange={(e) =>
                      setPricingConfig({ ...pricingConfig, protectionRate: Number(e.target.value) })
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
                  />
                </div>
              </div>
            </form>
          )}

          {/* 2. Zone Rate Slabs (PricingRule CRUD) */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900">Own-Network Zone Rate Slabs</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Add or toggle shipping price slabs per Origin Zone &rarr; Destination Zone and Service Speed.
            </p>

            <form
              onSubmit={handleAddPricingRule}
              className="mt-4 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-7"
            >
              <input
                type="text"
                required
                placeholder="Origin Zone"
                value={newRule.originZone}
                onChange={(e) => setNewRule({ ...newRule, originZone: e.target.value.toUpperCase() })}
                className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono uppercase"
              />
              <input
                type="text"
                required
                placeholder="Dest Zone"
                value={newRule.destZone}
                onChange={(e) => setNewRule({ ...newRule, destZone: e.target.value.toUpperCase() })}
                className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono uppercase"
              />
              <select
                value={newRule.serviceType}
                onChange={(e) =>
                  setNewRule({ ...newRule, serviceType: e.target.value as PricingRuleDTO['serviceType'] })
                }
                className="rounded border border-slate-300 bg-white px-2 py-1.5"
              >
                <option value="LOCAL">LOCAL</option>
                <option value="EXPRESS">EXPRESS</option>
                <option value="EXPRESS_PREMIUM">EXPRESS_PREMIUM</option>
                <option value="AIRMAX">AIRMAX</option>
                <option value="INTERCITY">INTERCITY</option>
                <option value="HYPERLOCAL">HYPERLOCAL</option>
                <option value="LTL_FREIGHT">LTL_FREIGHT</option>
                <option value="FTL_FREIGHT">FTL_FREIGHT</option>
                <option value="INTERNATIONAL">INTERNATIONAL</option>
                <option value="SCHEDULED">SCHEDULED</option>
                <option value="RETURN">RETURN</option>
              </select>
              <input
                type="number"
                step="0.5"
                min="0.5"
                required
                placeholder="Max Kg"
                value={newRule.maxWeightKg}
                onChange={(e) => setNewRule({ ...newRule, maxWeightKg: Number(e.target.value) })}
                className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
              />
              <input
                type="number"
                step="1"
                min="0"
                required
                placeholder="Price ₹"
                value={newRule.price}
                onChange={(e) => setNewRule({ ...newRule, price: Number(e.target.value) })}
                className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
              />
              <input
                type="number"
                min="1"
                required
                placeholder="ETA Days"
                value={newRule.etaDays}
                onChange={(e) => setNewRule({ ...newRule, etaDays: Number(e.target.value) })}
                className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
              />
              <button
                type="submit"
                className="rounded bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800"
              >
                + Save Slab
              </button>
            </form>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2">Origin &rarr; Dest</th>
                    <th className="px-3 py-2">Service</th>
                    <th className="px-3 py-2">Up To Weight</th>
                    <th className="px-3 py-2">Slab Base</th>
                    <th className="px-3 py-2">ETA</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pricingRules.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-mono font-semibold text-slate-800">
                        {r.originZone} &rarr; {r.destZone}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium">
                          {r.serviceType}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">{r.maxWeightKg} kg</td>
                      <td className="px-3 py-2.5 font-mono font-bold text-slate-900">₹{r.price}</td>
                      <td className="px-3 py-2.5">~{r.etaDays}d</td>
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => handleToggleRuleActive(r)}
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                            r.isActive
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {r.isActive ? 'Active' : 'Disabled'}
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => handleDeleteRule(r.id)}
                          className="text-rose-500 hover:text-rose-700"
                          title="Delete Rule"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 3. Serviceability: Cities & Pincodes Management */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <MapPinned className="h-5 w-5 text-indigo-600" />
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  City Activation &amp; Pincode Serviceability
                </h2>
                <p className="text-xs text-slate-500">
                  Own-network activation requires at least 1 hub, 1 own-pickup/delivery pincode, and 1 zone pricing rule.
                </p>
              </div>
            </div>

            {/* Add City + Add Pincode Forms */}
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <form
                onSubmit={handleCreateCity}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"
              >
                <span className="font-semibold text-slate-700 w-full">Register City:</span>
                <input
                  type="text"
                  required
                  placeholder="City (e.g. Hyderabad)"
                  value={newCity.name}
                  onChange={(e) => setNewCity({ ...newCity, name: e.target.value })}
                  className="flex-1 rounded border border-slate-300 bg-white px-2.5 py-1.5"
                />
                <input
                  type="text"
                  required
                  placeholder="State"
                  value={newCity.state}
                  onChange={(e) => setNewCity({ ...newCity, state: e.target.value })}
                  className="flex-1 rounded border border-slate-300 bg-white px-2.5 py-1.5"
                />
                <button
                  type="submit"
                  className="rounded bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800"
                >
                  Add City
                </button>
              </form>

              <form
                onSubmit={handleUpsertPincode}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"
              >
                <span className="font-semibold text-slate-700 w-full">Configure Pincode:</span>
                <input
                  type="text"
                  required
                  placeholder="Pincode (560002)"
                  value={newPincode.pincode}
                  onChange={(e) => setNewPincode({ ...newPincode, pincode: e.target.value })}
                  className="w-28 rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono"
                />
                <select
                  value={newPincode.cityId}
                  onChange={(e) => setNewPincode({ ...newPincode, cityId: e.target.value })}
                  className="rounded border border-slate-300 bg-white px-2 py-1.5"
                >
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  required
                  placeholder="Zone (BENGALURU-C)"
                  value={newPincode.zone}
                  onChange={(e) => setNewPincode({ ...newPincode, zone: e.target.value.toUpperCase() })}
                  className="flex-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono uppercase"
                />
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={newPincode.ownPickup}
                    onChange={(e) => setNewPincode({ ...newPincode, ownPickup: e.target.checked })}
                  />
                  Own Pickup
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={newPincode.ownDelivery}
                    onChange={(e) => setNewPincode({ ...newPincode, ownDelivery: e.target.checked })}
                  />
                  Own Delivery
                </label>
                <button
                  type="submit"
                  className="rounded bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700"
                >
                  Save Pincode
                </button>
              </form>
            </div>

            {/* Cities List */}
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {cities.map((c) => (
                <div key={c.id} className="rounded-lg border border-slate-200 p-4 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-bold text-slate-900">{c.name}</span>
                      <span className="ml-2 text-slate-500">{c.state}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          c.status === 'ACTIVE'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {c.status}
                      </span>
                      {c.status === 'ACTIVE' ? (
                        <button
                          type="button"
                          onClick={() => handleSuspendCity(c)}
                          className="rounded border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Suspend
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleActivateCity(c)}
                          className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                        >
                          Activate
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-600">
                    <span>Hubs: <strong>{c.prerequisites.hubCount}</strong></span>
                    <span>Own Pincodes: <strong>{c.prerequisites.ownPincodeCount}</strong></span>
                    <span>Pricing Rules: <strong>{c.prerequisites.pricingRulesCount}</strong></span>
                  </div>

                  {c.prerequisites.missing.length > 0 && c.status !== 'ACTIVE' && (
                    <p className="mt-1.5 text-[11px] text-amber-700">
                      Missing: {c.prerequisites.missing.join(' • ')}
                    </p>
                  )}

                  {c.pincodes.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.pincodes.map((p) => (
                        <span
                          key={p.pincode}
                          className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px]"
                        >
                          {p.pincode} ({p.zone}){p.ownPickup && p.ownDelivery ? ' [OWN]' : ' [3P]'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {token && (
            <AdminBulkCsvTools
              token={token}
              cities={cities}
              onReload={() => loadAll(token)}
              onMessage={(m) => {
                setMessage(m);
                setError(null);
              }}
              onError={(e) => setError(e)}
            />
          )}
        </div>
      )}

      {/* Phase 8 Tab: Support Tickets, Exceptions Queue & Notification Audit */}
      {adminTab === 'phase8' && (
        <div className="mt-6 space-y-8">
          {/* 1. Customer Support & Claim Queue */}
          {caps.canManageTickets && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <MessageSquare className="h-5 w-5 text-brand-600" />
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Customer Support Tickets &amp; Damage Claims
                </h2>
                <p className="text-xs text-slate-500">
                  Inspect customer tickets, reply, resolve disputes, or trigger verified claim refunds.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-6 lg:grid-cols-12">
              <div className="lg:col-span-5 divide-y divide-slate-100 rounded-lg border border-slate-200 max-h-[420px] overflow-y-auto">
                {adminTickets.length === 0 ? (
                  <p className="p-6 text-center text-xs text-slate-500">No support tickets yet.</p>
                ) : (
                  adminTickets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => token && getTicket(t.id, token).then(setActiveTicket).catch(() => {})}
                      className={`w-full p-3 text-left hover:bg-slate-50 ${
                        activeTicket?.id === t.id ? 'bg-indigo-50/70' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-slate-900 truncate">{t.subject}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            t.status === 'RESOLVED' || t.status === 'CLOSED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {t.type} &bull; {t.customerName || t.customerPhone || 'Customer'}
                        {t.shipment ? ` • ${t.shipment.awb}` : ''}
                      </p>
                    </button>
                  ))
                )}
              </div>

              <div className="lg:col-span-7">
                {activeTicket ? (
                  <div className="rounded-lg border border-slate-200 p-4 space-y-4 text-xs">
                    <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-2">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{activeTicket.subject}</p>
                        {activeTicket.shipment && (
                          <p className="font-mono text-[11px] text-indigo-700">
                            AWB: {activeTicket.shipment.awb} ({activeTicket.shipment.status}) &bull; Paid: ₹
                            {activeTicket.shipment.customerPrice ?? 0} &bull; Refunded: ₹{activeTicket.shipment.refunded}
                          </p>
                        )}
                      </div>
                      <span className="rounded bg-slate-900 px-2.5 py-0.5 text-[10px] font-bold text-white">
                        {activeTicket.status}
                      </span>
                    </div>

                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {activeTicket.messages.map((m) => (
                        <div key={m.id} className="rounded bg-slate-50 p-2.5 border border-slate-200">
                          <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                            <strong>
                              {m.authorName} ({m.authorRole})
                            </strong>
                            <span>{new Date(m.createdAt).toLocaleString()}</span>
                          </div>
                          <p className="text-slate-800">{m.body}</p>
                        </div>
                      ))}
                    </div>

                    {/* Reply */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Staff reply message..."
                        value={ticketReply}
                        onChange={(e) => setTicketReply(e.target.value)}
                        className="flex-1 rounded border border-slate-300 px-2.5 py-1.5"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (!token || !ticketReply.trim()) return;
                          await replyTicket(activeTicket.id, ticketReply.trim(), token);
                          setTicketReply('');
                          setActiveTicket(await getTicket(activeTicket.id, token));
                          await loadAll(token);
                        }}
                        className="rounded bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700"
                      >
                        Send Reply
                      </button>
                    </div>

                    {/* Resolve / Refund */}
                    <div className="rounded bg-slate-50 p-3 border border-slate-200 space-y-2">
                      <p className="font-bold text-slate-800">Resolve / Claim Decision</p>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="Resolution note"
                          value={resolutionNote}
                          onChange={(e) => setResolutionNote(e.target.value)}
                          className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                        />
                        {caps.canIssueRefund && (
                          <input
                            type="number"
                            placeholder="Optional Refund ₹"
                            value={claimRefundAmt}
                            onChange={(e) => setClaimRefundAmt(e.target.value)}
                            className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                          />
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(['RESOLVED', 'CLOSED', 'IN_REVIEW'] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={async () => {
                              if (!token) return;
                              setError(null);
                              try {
                                const res = await updateTicketStatus(
                                  activeTicket.id,
                                  {
                                    status: st,
                                    resolutionNote: resolutionNote || undefined,
                                    issueRefundAmount: Number(claimRefundAmt) > 0 ? Number(claimRefundAmt) : undefined,
                                  },
                                  token,
                                );
                                setMessage(
                                  `Ticket updated to ${st}${
                                    res.refund ? ` with Refund ₹${res.refund.amount}` : ''
                                  }.`,
                                );
                                setResolutionNote('');
                                setClaimRefundAmt('');
                                setActiveTicket(await getTicket(activeTicket.id, token));
                                await loadAll(token);
                              } catch (err: any) {
                                setError(err?.message || 'Failed to update ticket status');
                              }
                            }}
                            className="rounded bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800"
                          >
                            Mark {st}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-xs text-slate-500">
                    Click a ticket on the left to review or resolve it.
                  </div>
                )}
              </div>
            </div>
          </div>
          )}

          {/* 2. Flagged Tracking Events & Exception Queue */}
          {caps.canManageExceptions && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Flagged Events &amp; Operational Exceptions Queue
                </h2>
                <p className="text-xs text-slate-500">
                  Review out-of-order flagged partner events, log shipment exceptions, or mark lost parcels.
                </p>
              </div>
            </div>

            {/* Log Manual Exception Form */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!token || !newExc.awb || !newExc.remarks) return;
                setError(null);
                try {
                  const res = await logException(
                    {
                      awbOrShipmentId: newExc.awb,
                      exceptionCode: newExc.code,
                      remarks: newExc.remarks,
                      markLost: newExc.markLost,
                    },
                    token,
                  );
                  setMessage(`Exception logged for ${res.awb} (${res.shipmentStatus}).`);
                  setNewExc({ awb: '', code: 'DELAYED', remarks: '', markLost: false });
                  await loadAll(token);
                } catch (err: any) {
                  setError(err?.message || 'Failed to log exception');
                }
              }}
              className="mt-4 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-12"
            >
              <input
                type="text"
                required
                placeholder="AWB (e.g. BC2611...)"
                value={newExc.awb}
                onChange={(e) => setNewExc({ ...newExc, awb: e.target.value.toUpperCase() })}
                className="sm:col-span-3 rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono uppercase"
              />
              <select
                value={newExc.code}
                onChange={(e) => setNewExc({ ...newExc, code: e.target.value })}
                className="sm:col-span-3 rounded border border-slate-300 bg-white px-2 py-1.5"
              >
                {(exceptionQueue?.exceptionCodes ?? ['DELAYED', 'DAMAGED', 'ADDRESS_ISSUE', 'ROUTE_DISRUPTION']).map(
                  (c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ),
                )}
              </select>
              <input
                type="text"
                required
                placeholder="Exception details / action note"
                value={newExc.remarks}
                onChange={(e) => setNewExc({ ...newExc, remarks: e.target.value })}
                className="sm:col-span-3 rounded border border-slate-300 bg-white px-2.5 py-1.5"
              />
              <label className="sm:col-span-1 flex items-center gap-1 justify-center">
                <input
                  type="checkbox"
                  checked={newExc.markLost}
                  onChange={(e) => setNewExc({ ...newExc, markLost: e.target.checked })}
                />
                LOST
              </label>
              <button
                type="submit"
                className="sm:col-span-2 rounded bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700"
              >
                Log Exception
              </button>
            </form>

            {/* Flagged Events Table */}
            <div className="mt-4 space-y-2 text-xs">
              <p className="font-bold text-slate-700">
                Flagged Events Requiring Review ({exceptionQueue?.flaggedEvents.length ?? 0})
              </p>
              {(!exceptionQueue || exceptionQueue.flaggedEvents.length === 0) ? (
                <p className="text-slate-500">Zero unreviewed flagged tracking events.</p>
              ) : (
                exceptionQueue.flaggedEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50/60 p-3"
                  >
                    <div>
                      <span className="font-mono font-bold text-slate-900">
                        {ev.shipment?.awb || ev.shipmentId}
                      </span>
                      <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold">
                        {ev.source}
                      </span>
                      <p className="text-slate-700 mt-0.5">
                        Raw/Status: {ev.status || ev.rawStatus || ev.exceptionCode} &bull; {ev.remarks}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!token) return;
                        await acknowledgeFlaggedEvent(ev.id, 'Cleared by Ops', token);
                        setMessage('Flagged event acknowledged & cleared.');
                        await loadAll(token);
                      }}
                      className="rounded bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-slate-800"
                    >
                      Acknowledge &amp; Clear
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          )}

          {/* 3. Notification Dispatch Audit Log */}
          {caps.canViewNotifications && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Bell className="h-5 w-5 text-indigo-600" />
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  SMS &amp; Email Notification Audit Log ({adminNotifs.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Every milestone notification, delivery OTP dispatch, and ticket alert recorded automatically.
                </p>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                    <th className="px-3 py-2">Channel &amp; Template</th>
                    <th className="px-3 py-2">Target</th>
                    <th className="px-3 py-2">Message</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {adminNotifs.map((n) => (
                    <tr key={n.id}>
                      <td className="px-3 py-2 font-mono font-semibold text-slate-800">
                        [{n.channel}] {n.template}
                      </td>
                      <td className="px-3 py-2">{n.target}</td>
                      <td className="px-3 py-2 text-slate-600 max-w-md truncate">
                        {n.payload?.message || n.payload?.subject}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            n.status === 'SENT'
                              ? 'bg-emerald-100 text-emerald-800'
                              : n.status === 'FAILED'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {n.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {n.status !== 'SENT' && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (!token) return;
                              await retryNotification(n.id, token);
                              setMessage('Notification retried.');
                              await loadAll(token);
                            }}
                            className="rounded border border-slate-300 px-2 py-0.5 text-[10px] font-semibold hover:bg-slate-50"
                          >
                            Retry
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </div>
      )}

      {/* Phase 9 Tab: Analytics, KPIs, Finance & Reports */}
      {adminTab === 'phase9' && (
        <div className="mt-6 space-y-8">
          {/* Filter Bar & CSV Export */}
          {caps.canViewAnalytics && (
          <>
          <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700">From Date</label>
                <input
                  type="date"
                  value={reportFilter.from}
                  onChange={(e) => setReportFilter((p) => ({ ...p, from: e.target.value }))}
                  className="mt-1 rounded border border-slate-300 px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">To Date</label>
                <input
                  type="date"
                  value={reportFilter.to}
                  onChange={(e) => setReportFilter((p) => ({ ...p, to: e.target.value }))}
                  className="mt-1 rounded border border-slate-300 px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">Carrier Mode</label>
                <select
                  value={reportFilter.carrierType}
                  onChange={(e) => setReportFilter((p) => ({ ...p, carrierType: e.target.value }))}
                  className="mt-1 rounded border border-slate-300 bg-white px-2.5 py-1.5"
                >
                  <option value="">ALL (Own + Partner)</option>
                  <option value="OWN">OWN FLEET</option>
                  <option value="PARTNER">PARTNER 3P</option>
                </select>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!token) return;
                  const rep = await getAnalyticsReport(reportFilter, token).catch(() => null);
                  if (rep) setAnalytics(rep);
                }}
                className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800"
              >
                Apply Filters
              </button>
            </div>

            <button
              type="button"
              onClick={() =>
                token &&
                downloadShipmentsCsv(reportFilter, token).catch((e) =>
                  setError(e?.message || 'CSV export failed'),
                )
              }
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              <Download className="h-4 w-4" />
              Export Shipments CSV
            </button>
          </div>

          {analytics && (
            <>
              {/* SLA & Service Quality KPIs */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  {
                    label: 'On-Time Delivery',
                    value: `${analytics.summary.onTimeDeliveryPct}%`,
                    sub: `${analytics.summary.deliveredCount} delivered`,
                    cls: 'text-emerald-700',
                  },
                  {
                    label: 'First-Attempt Success',
                    value: `${analytics.summary.firstAttemptDeliveryPct}%`,
                    sub: 'No failed handovers',
                    cls: 'text-indigo-700',
                  },
                  {
                    label: 'Pickup Success Rate',
                    value: `${analytics.summary.pickupSuccessPct}%`,
                    sub: 'First-mile execution',
                    cls: 'text-slate-900',
                  },
                  {
                    label: 'RTO Rate',
                    value: `${analytics.summary.rtoRatePct}%`,
                    sub: `${analytics.summary.rtoCount} returned`,
                    cls: 'text-amber-700',
                  },
                  {
                    label: 'Damage / Loss Rate',
                    value: `${analytics.summary.damageLossRatePct}%`,
                    sub: `${analytics.summary.damageLossCount} affected`,
                    cls: 'text-rose-700',
                  },
                ].map((m) => (
                  <div key={m.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      {m.label}
                    </p>
                    <p className={`mt-1 text-2xl font-extrabold ${m.cls}`}>{m.value}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{m.sub}</p>
                  </div>
                ))}
              </div>

              {/* Financial Margin Cards & Status Distribution */}
              <div className="grid gap-6 lg:grid-cols-12">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-5">
                  <h3 className="text-sm font-bold text-slate-900">
                    Financial Summary ({analytics.financials.paidShipmentCount} Paid Shipments)
                  </h3>
                  <div className="mt-4 space-y-2.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Gross Revenue (Paid)</span>
                      <span className="font-mono font-bold text-slate-900">
                        ₹{analytics.financials.grossRevenue.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">GST Tax Collected</span>
                      <span className="font-mono text-slate-700">
                        - ₹{analytics.financials.totalTax.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Partner Courier Costs</span>
                      <span className="font-mono text-slate-700">
                        - ₹{analytics.financials.partnerCost.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Refunds Credited</span>
                      <span className="font-mono text-rose-700">
                        - ₹{analytics.financials.totalRefunded.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold">
                      <span className="text-slate-900">Net Operating Margin</span>
                      <span className="font-mono text-emerald-700">
                        ₹{analytics.financials.netMargin.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-7">
                  <h3 className="text-sm font-bold text-slate-900">
                    Shipment Status Distribution ({analytics.summary.totalShipments} total)
                  </h3>
                  <div className="mt-4 space-y-2.5 text-xs">
                    {analytics.statusDistribution.length === 0 ? (
                      <p className="text-slate-500">No shipments in selected range.</p>
                    ) : (
                      analytics.statusDistribution.map((row) => (
                        <div key={row.status}>
                          <div className="flex justify-between mb-1">
                            <span className="font-mono font-semibold text-slate-700">{row.status}</span>
                            <span className="text-slate-600">
                              {row.count} ({row.pct}%)
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full bg-indigo-600 rounded-full"
                              style={{ width: `${Math.min(100, row.pct)}%` }}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Own Fleet vs Partner Margin & Agent Productivity */}
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-900 mb-3">
                    Carrier Performance &amp; Margin (Own vs Partner)
                  </h3>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-[11px] uppercase text-slate-500">
                        <th className="py-2">Mode</th>
                        <th className="py-2">Shipments</th>
                        <th className="py-2">Delivered</th>
                        <th className="py-2">Failed/RTO</th>
                        {caps.canViewFinancialMetrics && <th className="py-2 text-right">Net Margin</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {analytics.carrierPerformance.map((cp) => (
                        <tr key={cp.carrierType}>
                          <td className="py-2.5 font-bold text-slate-900">{cp.carrierType}</td>
                          <td className="py-2.5">{cp.shipmentCount}</td>
                          <td className="py-2.5 text-emerald-700 font-semibold">{cp.deliveredCount}</td>
                          <td className="py-2.5 text-rose-700">{cp.troubledCount}</td>
                          {caps.canViewFinancialMetrics && (
                            <td className="py-2.5 text-right font-mono font-bold text-slate-900">
                              ₹{cp.margin.toFixed(2)}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-900 mb-3">Agent Productivity Leaderboard</h3>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-[11px] uppercase text-slate-500">
                        <th className="py-2">Agent</th>
                        <th className="py-2">Pickups</th>
                        <th className="py-2">Deliveries</th>
                        <th className="py-2">Failed</th>
                        <th className="py-2 text-right">Total Done</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {analytics.agentProductivity.map((ag) => (
                        <tr key={ag.agentId}>
                          <td className="py-2.5 font-semibold text-slate-900">
                            {ag.name} <span className="text-[10px] text-slate-500">({ag.cityName})</span>
                          </td>
                          <td className="py-2.5">{ag.pickupsCompleted}</td>
                          <td className="py-2.5">{ag.deliveriesCompleted}</td>
                          <td className="py-2.5 text-rose-600">{ag.failedTasks}</td>
                          <td className="py-2.5 text-right font-bold text-indigo-700">
                            {ag.totalCompleted}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          </>
          )}

          {/* Finance Ledger: Payments, Refunds & GST Invoices */}
          {caps.canViewFinanceLedger && financeLedger && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Finance Ledger — Sequential GST Invoices, Payments &amp; Refunds
                </h3>
                <p className="text-xs text-slate-500">
                  {financeLedger.invoices.length} invoice(s) &bull; {financeLedger.payments.length} payment(s) &bull;{' '}
                  {financeLedger.refunds.length} refund(s)
                </p>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Issued Sequential GST Invoices
                  </h4>
                  <div className="max-h-60 overflow-y-auto rounded border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Invoice No</th>
                          <th className="px-3 py-2">AWB</th>
                          <th className="px-3 py-2">Total</th>
                          <th className="px-3 py-2">PDF</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {financeLedger.invoices.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                              No invoices generated yet. Click Invoice on any shipment to generate.
                            </td>
                          </tr>
                        ) : (
                          financeLedger.invoices.map((inv) => (
                            <tr key={inv.id}>
                              <td className="px-3 py-2 font-mono font-bold text-slate-900">{inv.number}</td>
                              <td className="px-3 py-2 font-mono text-indigo-600">{inv.awb || '-'}</td>
                              <td className="px-3 py-2 font-mono">₹{inv.total.toFixed(2)}</td>
                              <td className="px-3 py-2">
                                {inv.shipmentId && inv.awb && (
                                  <button
                                    type="button"
                                    onClick={() => token && downloadShipmentInvoice(inv.shipmentId!, inv.awb!, token)}
                                    className="text-emerald-700 font-semibold hover:underline"
                                  >
                                    Download
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Recent Payments &amp; Refunds
                  </h4>
                  <div className="max-h-60 overflow-y-auto rounded border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2">AWB / Ref</th>
                          <th className="px-3 py-2">Amount</th>
                          <th className="px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {financeLedger.payments.map((p) => (
                          <tr key={p.id}>
                            <td className="px-3 py-2 font-semibold">{p.provider}</td>
                            <td className="px-3 py-2 font-mono text-slate-700">{p.awb || p.shipmentId.slice(0, 8)}</td>
                            <td className="px-3 py-2 font-mono">₹{p.amount.toFixed(2)}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                  p.status === 'PAID'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {p.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {financeLedger.refunds.map((r) => (
                          <tr key={r.id} className="bg-rose-50/40">
                            <td className="px-3 py-2 font-semibold text-rose-700">REFUND</td>
                            <td className="px-3 py-2 text-slate-600 truncate max-w-[140px]">{r.reason}</td>
                            <td className="px-3 py-2 font-mono text-rose-700">-₹{r.amount.toFixed(2)}</td>
                            <td className="px-3 py-2 text-[10px] font-bold text-rose-700">CREDITED</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {token && caps.canViewFinanceLedger && (
            <AdminCodSettlementPanel
              token={token}
              caps={caps}
              onMessage={(m) => {
                setMessage(m);
                setError(null);
              }}
              onError={(e) => setError(e)}
            />
          )}
        </div>
      )}

      {adminTab === 'enterprise' && token && caps.canManageEnterprise && (
        <AdminEnterpriseTab
          token={token}
          caps={caps}
          onMessage={(m) => {
            setMessage(m);
            setError(null);
          }}
          onError={(e) => setError(e)}
        />
      )}

      {adminTab === 'governance' && token && caps.canViewGovernance && (
        <AdminGovernanceTab
          token={token}
          caps={caps}
          onMessage={(m) => {
            setMessage(m);
            setError(null);
          }}
          onError={(e) => setError(e)}
        />
      )}
    </div>
  );
}

