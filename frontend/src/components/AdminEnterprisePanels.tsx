'use client';

import { useState, useEffect } from 'react';
import {
  bulkUpsertPincodes,
  bulkUpsertPricingRules,
  listAdminPromos,
  upsertPromoCode,
  togglePromoCode,
  listAdminB2BAccounts,
  updateAdminB2BAccount,
  listInquiries,
  updateInquiryStatus,
  getCodReport,
  remitCodShipment,
  listAuditLogs,
  listWebhookLogs,
  getCompanySettings,
  updateCompanySettings,
  getNetworkOverview,
  AdminCityDTO,
  PromoCodeDTO,
  LogisticsInquiryDTO,
  CodReportDTO,
  CompanySettingsDTO,
} from '@/lib/api';
import { RoleCapabilities } from '@/lib/rbac';
import {
  Activity,
  Banknote,
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  Inbox,
  Network,
  RefreshCw,
  ScrollText,
  Settings,
  Tag,
  Truck,
  Webhook,
} from 'lucide-react';

interface PanelProps {
  token: string;
  caps: RoleCapabilities;
  onMessage: (msg: string) => void;
  onError: (err: string) => void;
}

export function AdminBulkCsvTools({
  token,
  cities,
  onReload,
  onMessage,
  onError,
}: {
  token: string;
  cities: AdminCityDTO[];
  onReload: () => Promise<void>;
  onMessage: (m: string) => void;
  onError: (e: string) => void;
}) {
  const [cityId, setCityId] = useState(cities[0]?.id ?? '');
  const [pincodeCsv, setPincodeCsv] = useState(
    '560002,BENGALURU-C,true,true,true\n560078,BENGALURU-S,true,true,true',
  );
  const [ruleCsv, setRuleCsv] = useState(
    'EXPRESS_PREMIUM,BENGALURU-S,MUMBAI-W,5,549,1\nAIRMAX,BENGALURU-S,DELHI-NCR,20,1390,1',
  );

  useEffect(() => {
    if (!cityId && cities.length > 0) setCityId(cities[0].id);
  }, [cities, cityId]);

  const handleBulkPincodes = async () => {
    if (!cityId) return;
    try {
      const rows = pincodeCsv
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [pincode, zone, ownPickup, ownDelivery, partner] = line.split(',').map((s) => s.trim());
          return {
            pincode,
            cityId,
            zone: zone.toUpperCase(),
            ownPickup: ownPickup !== 'false',
            ownDelivery: ownDelivery !== 'false',
            partnerServiceable: partner !== 'false',
          };
        });
      const r = await bulkUpsertPincodes(rows, token);
      onMessage(`Bulk pincodes imported: ${r.imported} saved, ${r.failed} errors.`);
      await onReload();
    } catch (e: any) {
      onError(e?.message || 'Bulk pincode upload failed');
    }
  };

  const handleBulkRules = async () => {
    try {
      const rows = ruleCsv
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [serviceType, originZone, destZone, maxW, price, eta] = line.split(',').map((s) => s.trim());
          return {
            serviceType: serviceType.toUpperCase(),
            originZone: originZone.toUpperCase(),
            destZone: destZone.toUpperCase(),
            maxWeightKg: Number(maxW),
            price: Number(price),
            etaDays: Number(eta) || 2,
            isActive: true,
          };
        });
      const r = await bulkUpsertPricingRules(rows, token);
      onMessage(`Bulk pricing rules imported: ${r.imported} slabs upserted.`);
      await onReload();
    } catch (e: any) {
      onError(e?.message || 'Bulk rule import failed');
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm text-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
            <FileSpreadsheet className="h-4 w-4 text-brand-600" /> Bulk CSV Pincode Importer
          </h3>
          <select
            value={cityId}
            onChange={(e) => setCityId(e.target.value)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
          >
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-slate-500">Format: `pincode,zone,ownPickup,ownDelivery,partnerServiceable`</p>
        <textarea
          rows={3}
          value={pincodeCsv}
          onChange={(e) => setPincodeCsv(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono text-[11px]"
        />
        <button
          type="button"
          onClick={handleBulkPincodes}
          className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-brand-600"
        >
          Import Pincode Batch
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm text-xs space-y-3">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
          <FileSpreadsheet className="h-4 w-4 text-brand-600" /> Bulk CSV Pricing Slab Importer
        </h3>
        <p className="text-slate-500">Format: `serviceType,originZone,destZone,maxWeightKg,price,etaDays`</p>
        <textarea
          rows={3}
          value={ruleCsv}
          onChange={(e) => setRuleCsv(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono text-[11px]"
        />
        <button
          type="button"
          onClick={handleBulkRules}
          className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-brand-600"
        >
          Import Slab Batch
        </button>
      </div>
    </div>
  );
}

export function AdminCodSettlementPanel({ token, onMessage, onError }: PanelProps) {
  const [cod, setCod] = useState<CodReportDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setCod(await getCodReport(token));
    } catch (e: any) {
      onError(e?.message || 'Failed to load COD ledger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [token]);

  const handleRemit = async (shipmentId: string, awb: string) => {
    try {
      await remitCodShipment(shipmentId, token);
      onMessage(`COD remittance settled for ${awb}.`);
      await load();
    } catch (e: any) {
      onError(e?.message || 'Remittance failed');
    }
  };

  if (loading || !cod) {
    return <div className="text-xs text-slate-500 py-4">Loading COD settlement ledger...</div>;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <Banknote className="h-5 w-5 text-rose-600" />
          <div>
            <h3 className="text-base font-bold text-slate-900">COD Cash Collection &amp; Remittance Ledger</h3>
            <p className="text-xs text-slate-500">Track doorstep cash collected by field agents and mark batches remitted.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700"
        >
          <RefreshCw className="h-3 w-3" /> Refresh COD
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-slate-500 font-semibold">Pending Doorstep Collection</p>
          <p className="font-mono text-lg font-extrabold text-amber-800">₹{cod.summary.pendingCollection.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="text-slate-500 font-semibold">Collected &bull; Awaiting Remit</p>
          <p className="font-mono text-lg font-extrabold text-rose-800">₹{cod.summary.awaitingRemittance.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-slate-500 font-semibold">Settled / Remitted</p>
          <p className="font-mono text-lg font-extrabold text-emerald-800">₹{cod.summary.remittedTotal.toFixed(2)}</p>
        </div>
      </div>

      <div className="max-h-56 overflow-y-auto rounded border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">AWB</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">COD Amount</th>
              <th className="px-3 py-2">Collection</th>
              <th className="px-3 py-2">Remittance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cod.shipments.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                  No Cash on Delivery shipments yet.
                </td>
              </tr>
            ) : (
              cod.shipments.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-mono font-bold text-slate-900">{s.awb}</td>
                  <td className="px-3 py-2">{s.status}</td>
                  <td className="px-3 py-2 font-mono">₹{s.codAmount.toFixed(2)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${s.codCollected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                      {s.codCollected ? 'COLLECTED' : 'PENDING'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {s.codRemitted ? (
                      <span className="text-emerald-700 font-bold">REMITTED</span>
                    ) : s.codCollected ? (
                      <button
                        type="button"
                        onClick={() => handleRemit(s.id, s.awb)}
                        className="rounded bg-slate-900 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-brand-600"
                      >
                        Mark Remitted
                      </button>
                    ) : (
                      <span className="text-slate-400">Awaiting delivery</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminEnterpriseTab({ token, onMessage, onError }: PanelProps) {
  const [promos, setPromos] = useState<PromoCodeDTO[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [inquiries, setInquiries] = useState<LogisticsInquiryDTO[]>([]);
  const [network, setNetwork] = useState<any>(null);

  const [newPromo, setNewPromo] = useState({
    code: '',
    description: '',
    discountType: 'PERCENT' as 'PERCENT' | 'FLAT',
    discountValue: 15,
    maxDiscount: 200,
    minOrderAmount: 100,
  });

  const load = async () => {
    try {
      const [p, a, inq, net] = await Promise.all([
        listAdminPromos(token).catch(() => []),
        listAdminB2BAccounts(token).catch(() => []),
        listInquiries(token).catch(() => []),
        getNetworkOverview(token).catch(() => null),
      ]);
      setPromos(p);
      setAccounts(a);
      setInquiries(inq);
      setNetwork(net);
    } catch (e: any) {
      onError(e?.message || 'Failed loading enterprise desk');
    }
  };

  useEffect(() => {
    load();
  }, [token]);

  const handleSavePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await upsertPromoCode(
        {
          ...newPromo,
          maxDiscount: newPromo.maxDiscount || null,
          isActive: true,
        },
        token,
      );
      setNewPromo({ code: '', description: '', discountType: 'PERCENT', discountValue: 15, maxDiscount: 200, minOrderAmount: 100 });
      onMessage('Promo campaign saved!');
      await load();
    } catch (err: any) {
      onError(err?.message || 'Failed saving promo');
    }
  };

  return (
    <div className="mt-6 space-y-6 text-xs">
      {/* Live Network Hub & Fleet Summary */}
      {network && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Network className="h-5 w-5 text-brand-600" /> Network Coverage, Hub Nodes &amp; NDR Monitor
            </h2>
            <span className="rounded-full bg-rose-50 border border-rose-200 px-3 py-1 font-bold text-rose-700">
              Open NDR / Failed Re-attempts: {network.openNdr}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
              <p className="font-bold text-slate-900 mb-2">Active Sorting Hubs ({network.hubs.length})</p>
              <ul className="space-y-1.5 text-slate-600">
                {network.hubs.map((h: any) => (
                  <li key={h.id}>
                    <strong>{h.name}</strong> &bull; {h.city.name}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
              <p className="font-bold text-slate-900 mb-2">Linehaul Fleet Vehicles ({network.vehicles.length})</p>
              <ul className="space-y-1.5 text-slate-600">
                {network.vehicles.map((v: any) => (
                  <li key={v.id}>
                    <span className="font-mono font-bold text-slate-900">{v.regNo}</span> &bull; {v.type} ({v.capacityKg} kg)
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
              <p className="font-bold text-slate-900 mb-2">Recent Dispatch Manifests ({network.manifests.length})</p>
              {network.manifests.length === 0 ? (
                <p className="text-slate-400">No manifests closed yet.</p>
              ) : (
                <ul className="space-y-1.5 text-slate-600">
                  {network.manifests.slice(0, 5).map((m: any) => (
                    <li key={m.id}>
                      <span className="font-mono font-bold text-slate-900">{m.code}</span> &rarr; {m.destinationLabel} ({m.status})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Promo Campaigns + B2B Accounts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Tag className="h-4 w-4 text-express-600" /> Promotional Coupon Manager
          </h2>

          <form onSubmit={handleSavePromo} className="grid grid-cols-2 gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <input type="text" required placeholder="Code (WELCOME20)" value={newPromo.code} onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono uppercase" />
            <input type="text" required placeholder="Short description" value={newPromo.description} onChange={(e) => setNewPromo({ ...newPromo, description: e.target.value })} className="rounded border border-slate-300 bg-white px-2.5 py-1.5" />
            <select value={newPromo.discountType} onChange={(e) => setNewPromo({ ...newPromo, discountType: e.target.value as any })} className="rounded border border-slate-300 bg-white px-2.5 py-1.5">
              <option value="PERCENT">Percent Off (%)</option>
              <option value="FLAT">Flat Discount (₹)</option>
            </select>
            <input type="number" required min="1" placeholder="Value" value={newPromo.discountValue} onChange={(e) => setNewPromo({ ...newPromo, discountValue: Number(e.target.value) })} className="rounded border border-slate-300 bg-white px-2.5 py-1.5" />
            <input type="number" placeholder="Max Cap (₹)" value={newPromo.maxDiscount} onChange={(e) => setNewPromo({ ...newPromo, maxDiscount: Number(e.target.value) })} className="rounded border border-slate-300 bg-white px-2.5 py-1.5" />
            <button type="submit" className="rounded-lg bg-brand-600 px-3 py-1.5 font-bold text-white hover:bg-brand-700">
              Save Promo Campaign
            </button>
          </form>

          <div className="space-y-2 max-h-56 overflow-y-auto">
            {promos.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/70 p-2.5">
                <div>
                  <span className="font-mono font-extrabold text-slate-900">{p.code}</span>
                  <span className="ml-2 text-slate-500">Used {p.usedCount ?? 0}x</span>
                  <p className="text-[11px] text-slate-600">{p.description}</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await togglePromoCode(p.id, !p.isActive, token);
                    await load();
                  }}
                  className={`rounded-full px-3 py-1 text-[10px] font-bold ${
                    p.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {p.isActive ? 'ACTIVE' : 'PAUSED'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* B2B Corporate Account & Credit Approval Desk */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-brand-600" /> B2B Corporate Accounts &amp; Contracts
          </h2>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {accounts.length === 0 ? (
              <p className="text-slate-400">No corporate applications yet.</p>
            ) : (
              accounts.map((acc) => (
                <div key={acc.id} className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-slate-900">{acc.legalName}</p>
                      <p className="font-mono text-[11px] text-slate-500">
                        GSTIN: {acc.gstin || 'N/A'} &bull; Credit ₹{Number(acc.creditLimit).toLocaleString('en-IN')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await updateAdminB2BAccount(acc.id, { isApproved: !acc.isApproved }, token);
                        onMessage(`Updated approval status for ${acc.legalName}`);
                        await load();
                      }}
                      className={`rounded-lg px-3 py-1 font-bold text-[11px] ${
                        acc.isApproved ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-600 text-white'
                      }`}
                    >
                      {acc.isApproved ? 'Approved' : 'Approve GSTIN'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 3PL / FTL / Franchise / ONDC Inquiry Inbox */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Inbox className="h-4 w-4 text-brand-600" /> Enterprise Inquiries (3PL, FTL, Cold-Chain, Franchise) ({inquiries.length})
        </h2>
        <div className="space-y-2.5 max-h-72 overflow-y-auto">
          {inquiries.length === 0 ? (
            <p className="text-slate-400">No 3PL or partner inquiries submitted yet.</p>
          ) : (
            inquiries.map((inq) => (
              <div key={inq.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">
                      {inq.solutionType.replace(/_/g, ' ')}
                    </span>
                    <span className="font-bold text-slate-900">{inq.customerName}</span>
                    {inq.companyName && <span className="text-slate-500">({inq.companyName})</span>}
                  </div>
                  <p className="text-slate-600 mt-1">{inq.notes}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {inq.email} &bull; {inq.phone} &bull; {inq.originCity ?? ''} &rarr; {inq.destCity ?? ''}
                  </p>
                </div>
                <select
                  value={inq.status}
                  onChange={async (e) => {
                    await updateInquiryStatus(inq.id, { status: e.target.value }, token);
                    onMessage(`Updated inquiry status to ${e.target.value}`);
                    await load();
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-semibold"
                >
                  <option value="NEW">NEW</option>
                  <option value="CONTACTED">CONTACTED</option>
                  <option value="QUOTED">QUOTED</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function AdminGovernanceTab({ token, caps, onMessage, onError }: PanelProps) {
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [settings, setSettings] = useState<CompanySettingsDTO | null>(null);
  const [auditFilter, setAuditFilter] = useState('');

  const load = async () => {
    try {
      const [aud, wh, cfg] = await Promise.all([
        listAuditLogs(auditFilter || undefined, token).catch(() => []),
        listWebhookLogs(token).catch(() => []),
        getCompanySettings(token).catch(() => null),
      ]);
      setAuditLogs(aud);
      setWebhooks(wh);
      setSettings(cfg);
    } catch (e: any) {
      onError(e?.message || 'Failed loading governance logs');
    }
  };

  useEffect(() => {
    load();
  }, [token]);

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    try {
      await updateCompanySettings(settings.profile, token);
      onMessage('Company GSTIN & Invoice/Label branding saved!');
    } catch (err: any) {
      onError(err?.message || 'Failed to update branding');
    }
  };

  return (
    <div className="mt-6 space-y-6 text-xs">
      {/* Company GSTIN & Notification Channel Settings */}
      {settings && (
        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={handleSaveBranding} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Settings className="h-4 w-4 text-brand-600" /> Seller GSTIN &amp; Invoice/Label Branding
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Brand / Legal Name</label>
                <input
                  type="text"
                  value={settings.profile.brandName}
                  onChange={(e) => setSettings({ ...settings, profile: { ...settings.profile, brandName: e.target.value } })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Company GSTIN</label>
                <input
                  type="text"
                  value={settings.profile.gstin}
                  onChange={(e) => setSettings({ ...settings, profile: { ...settings.profile, gstin: e.target.value } })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Registered Office Address</label>
              <input
                type="text"
                value={settings.profile.address}
                onChange={(e) => setSettings({ ...settings, profile: { ...settings.profile, address: e.target.value } })}
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
              />
            </div>
            {(caps.tier === 'SUPER_ADMIN' || caps.role === 'FINANCE') && (
              <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 font-bold text-white hover:bg-brand-600">
                Save Invoice &amp; Label Config
              </button>
            )}
          </form>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Activity className="h-4 w-4 text-brand-600" /> Active Notification &amp; Payment Gateways
            </h2>
            <div className="space-y-2.5">
              <div className="flex justify-between rounded-lg bg-slate-50 p-3 border border-slate-100">
                <span className="font-semibold text-slate-700">SMS Notification Channel</span>
                <span className="font-mono font-bold text-slate-900">{settings.channels.smsProvider.toUpperCase()}</span>
              </div>
              <div className="flex justify-between rounded-lg bg-slate-50 p-3 border border-slate-100">
                <span className="font-semibold text-slate-700">Email OTP &amp; Alert Channel</span>
                <span className="font-mono font-bold text-slate-900">{settings.channels.emailProvider.toUpperCase()}</span>
              </div>
              <div className="flex justify-between rounded-lg bg-slate-50 p-3 border border-slate-100">
                <span className="font-semibold text-slate-700">Payment Gateway Engine</span>
                <span className="font-mono font-bold text-emerald-700">{settings.channels.paymentGateway}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Audit Log Viewer */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-brand-600" /> Security &amp; Operations Audit Logs ({auditLogs.length})
          </h2>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Filter action (e.g., pricing)"
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1"
            />
            <button type="button" onClick={load} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold">
              Filter
            </button>
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto rounded border border-slate-200">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Timestamp</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Entity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2 text-slate-500">{new Date(l.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 font-semibold text-slate-800">{l.actor?.name ?? l.actorUserId?.slice(0, 8) ?? 'SYSTEM'}</td>
                  <td className="px-3 py-2 font-mono font-bold text-brand-700">{l.action}</td>
                  <td className="px-3 py-2 font-mono text-slate-600">{l.entity}:{l.entityId.slice(0, 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Partner Webhook Inspector */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Webhook className="h-4 w-4 text-indigo-600" /> Partner Carrier Webhook Event Inspector ({webhooks.length})
        </h2>
        <div className="max-h-56 overflow-y-auto rounded border border-slate-200">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Carrier</th>
                <th className="px-3 py-2">Processed</th>
                <th className="px-3 py-2">Payload</th>
                <th className="px-3 py-2">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {webhooks.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                    No inbound partner webhooks recorded yet.
                  </td>
                </tr>
              ) : (
                webhooks.map((w) => (
                  <tr key={w.id}>
                    <td className="px-3 py-2 font-mono font-bold">{w.carrierCode}</td>
                    <td className="px-3 py-2">{w.processed ? 'OK' : 'FAILED'}</td>
                    <td className="px-3 py-2 font-mono text-[10px] truncate max-w-xs">{JSON.stringify(w.body)}</td>
                    <td className="px-3 py-2 text-slate-500">{new Date(w.receivedAt).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

