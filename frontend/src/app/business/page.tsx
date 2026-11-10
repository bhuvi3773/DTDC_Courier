'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  getB2BProfile,
  applyB2BAccount,
  bulkQuote,
  bulkBookShipments,
  createPartnerApiKey,
  deletePartnerApiKey,
  testPartnerWebhook,
  B2BProfileDTO,
  BulkRowInput,
} from '@/lib/api';
import { useAuthSession } from '@/hooks/useAuthSession';
import { AccessRestricted } from '@/components/AccessRestricted';
import {
  Building2,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  KeyRound,
  Plus,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';

const SAMPLE_CSV = `fromPincode,toPincode,recipientName,recipientPhone,recipientLine1,recipientCity,recipientState,weightKg,serviceType,packaging,fulfillmentMode,paymentMethod,goodsDescription
560001,560038,Ananya Rao,9845000011,22 100ft Rd Indiranagar,Bengaluru,Karnataka,1.5,LOCAL,CUSTOMER_PACKED,OWN,PREPAID,Hardcover Books
560001,400001,Vikram Shah,9820000022,14 MIDC Andheri East,Mumbai,Maharashtra,3.0,EXPRESS_PREMIUM,COMPANY_PACKED,PARTNER,COD,Medical Device Kits
560001,110001,Meera Gupta,9811000033,8 Connaught Place,New Delhi,Delhi,2.5,AIRMAX,TEMPERATURE_CONTROLLED,PARTNER,PREPAID,Cold-Chain Sample`;

function parseCsvToRows(text: string): BulkRowInput[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const start = lines[0].toLowerCase().includes('frompincode') ? 1 : 0;
  return lines.slice(start).map((line) => {
    const c = line.split(',').map((s) => s.trim());
    return {
      fromPincode: c[0] || '560001',
      toPincode: c[1] || '560038',
      recipientName: c[2] || 'Recipient',
      recipientPhone: c[3] || '9000000011',
      recipientLine1: c[4] || 'Address Line 1',
      recipientCity: c[5] || 'Bengaluru',
      recipientState: c[6] || 'Karnataka',
      weightKg: Number(c[7]) || 1,
      serviceType: c[8] || 'INTERCITY',
      packaging: c[9] || 'CUSTOMER_PACKED',
      fulfillmentMode: (c[10] === 'PARTNER' ? 'PARTNER' : 'OWN') as 'OWN' | 'PARTNER',
      paymentMethod: (c[11] === 'COD' ? 'COD' : c[11] === 'CORPORATE_CREDIT' ? 'CORPORATE_CREDIT' : 'PREPAID') as
        | 'PREPAID'
        | 'COD'
        | 'CORPORATE_CREDIT',
      goodsDescription: c[12] || 'Commercial Dispatch',
      destinationCountry: 'IN',
    };
  });
}

export default function BusinessPortalPage() {
  const session = useAuthSession({ redirectIfUnauth: true });
  const token = session.token;
  const [tab, setTab] = useState<'csv' | 'account' | 'api'>('csv');

  const [profile, setProfile] = useState<B2BProfileDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Corporate Account form
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [creditReq, setCreditReq] = useState(50000);

  // Bulk CSV state
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [pickupName, setPickupName] = useState('Apex Warehouse Desk');
  const [pickupPhone, setPickupPhone] = useState('9000000020');
  const [pickupLine1, setPickupLine1] = useState('12, Church Street Logistics Bay');
  const [pickupCity, setPickupCity] = useState('Bengaluru');
  const [pickupState, setPickupState] = useState('Karnataka');
  const [quotePreview, setQuotePreview] = useState<{
    results: any[];
    totalAmount: number;
    hasCorporateRate: boolean;
  } | null>(null);
  const [bookResult, setBookResult] = useState<{
    createdCount: number;
    failedCount: number;
    created: Array<{ index: number; awb: string; price: string; carrierMode: string }>;
    failed: Array<{ index: number; recipientName: string; error: string }>;
  } | null>(null);
  const [working, setWorking] = useState(false);

  // ONDC / API Keys
  const [keyLabel, setKeyLabel] = useState('ONDC Seller Production');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [ondcSubId, setOndcSubId] = useState('ondc.seller.example.in');
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [webhookTestRes, setWebhookTestRes] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      if (p.get('tab') === 'api') setTab('api');
      if (p.get('tab') === 'account') setTab('account');
    }
  }, []);

  useEffect(() => {
    if (session.loading || !session.token) return;
    if (!session.capabilities.canViewBusinessPortal) {
      setLoading(false);
      return;
    }
    loadProfile(session.token);
  }, [session.loading, session.token, session.capabilities.canViewBusinessPortal]);

  const loadProfile = async (t: string) => {
    setLoading(true);
    try {
      const p = await getB2BProfile(t);
      setProfile(p);
      if (p.businessAccount) {
        setLegalName(p.businessAccount.legalName);
        setGstin(p.businessAccount.gstin ?? '');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load business profile');
    } finally {
      setLoading(false);
    }
  };

  const handleBulkQuote = async () => {
    if (!token) return;
    setError(null);
    setBanner(null);
    setBookResult(null);
    const rows = parseCsvToRows(csvText);
    if (rows.length === 0) {
      setError('Paste at least 1 valid CSV row.');
      return;
    }
    setWorking(true);
    try {
      const res = await bulkQuote(rows, token);
      setQuotePreview(res);
    } catch (err: any) {
      setError(err?.message || 'Batch quote failed');
    } finally {
      setWorking(false);
    }
  };

  const handleBulkBook = async () => {
    if (!token) return;
    setError(null);
    setBanner(null);
    const rows = parseCsvToRows(csvText);
    if (rows.length === 0) return;
    setWorking(true);
    try {
      const res = await bulkBookShipments(
        {
          name: pickupName,
          phone: pickupPhone,
          line1: pickupLine1,
          city: pickupCity,
          state: pickupState,
          pincode: rows[0].fromPincode,
        },
        rows,
        token,
      );
      setBookResult(res);
      setBanner(`Batch complete: ${res.createdCount} shipment(s) created cleanly!`);
    } catch (err: any) {
      setError(err?.message || 'Batch booking failed');
    } finally {
      setWorking(false);
    }
  };

  const handleDownloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bookcourier-bulk-template.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const handleCsvFileUpload = async (file: File) => {
    const text = await file.text();
    setCsvText(text);
    setQuotePreview(null);
  };

  const handleApplyAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setBanner(null);
    try {
      await applyB2BAccount({ legalName, gstin: gstin || undefined, requestedCreditLimit: creditReq }, token);
      setBanner('Corporate GSTIN profile submitted! Status refreshes on admin approval.');
      await loadProfile(token);
    } catch (err: any) {
      setError(err?.message || 'Failed to save B2B account');
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setFreshKey(null);
    try {
      const created = await createPartnerApiKey(
        { label: keyLabel, webhookUrl: webhookUrl || undefined, ondcSubscriberId: ondcSubId || undefined },
        token,
      );
      setFreshKey(created.plaintextKey);
      setBanner('API key generated! Copy your key now — only the hash is persisted.');
      await loadProfile(token);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate API key');
    }
  };

  if (session.loading || loading) {
    return <div className="py-12 text-center text-xs text-slate-500">Loading Business Portal...</div>;
  }
  if (!session.capabilities.canViewBusinessPortal) {
    return (
      <AccessRestricted
        roleLabel={session.capabilities.label}
        requiredLabel="Customer or B2B Accounts"
        fallbackHref={session.capabilities.defaultHome}
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            B2B Corporate, <span className="text-brand-600">Bulk CSV</span> &amp; ONDC API Portal
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Batch upload multi-row CSV manifests, manage corporate credit &amp; GSTIN rates, and configure ONDC/E-Commerce webhooks.
          </p>
        </div>

        <div className="flex gap-2 text-xs">
          <Link href="/orders" className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-bold text-slate-700 hover:bg-slate-50">
            View My Shipments
          </Link>
        </div>
      </div>

      {banner && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-800">
          {banner}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-2 text-xs font-bold">
        {[
          { id: 'csv' as const, label: 'Bulk CSV Shipment Uploader', icon: FileSpreadsheet },
          { id: 'account' as const, label: 'Corporate Account & Credit Line', icon: Building2 },
          { id: 'api' as const, label: 'E-Commerce & ONDC API / Webhooks', icon: KeyRound },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 border transition ${
              tab === t.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'csv' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">1. Dispatch Origin &amp; CSV Manifest</h2>
                <p className="text-xs text-slate-500">
                  Upload a `.csv` file or edit the template below (supports up to 50 shipments per batch).
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={handleDownloadSample}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> Sample CSV
                </button>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 font-semibold text-brand-700 hover:bg-brand-100">
                  <Upload className="h-3.5 w-3.5" /> Load .csv File
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleCsvFileUpload(f);
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="grid sm:grid-cols-5 gap-3 text-xs">
              <input type="text" value={pickupName} onChange={(e) => setPickupName(e.target.value)} placeholder="Warehouse / Sender" className="rounded-lg border border-slate-300 px-3 py-1.5" />
              <input type="text" value={pickupPhone} onChange={(e) => setPickupPhone(e.target.value)} placeholder="Phone" className="rounded-lg border border-slate-300 px-3 py-1.5" />
              <input type="text" value={pickupLine1} onChange={(e) => setPickupLine1(e.target.value)} placeholder="Dock Address" className="sm:col-span-2 rounded-lg border border-slate-300 px-3 py-1.5" />
              <input type="text" value={pickupCity} onChange={(e) => setPickupCity(e.target.value)} placeholder="City" className="rounded-lg border border-slate-300 px-3 py-1.5" />
            </div>

            <textarea
              rows={7}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-slate-950 p-3 font-mono text-[11px] text-emerald-300 focus:outline-none"
            />

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleBulkQuote}
                disabled={working}
                className="rounded-xl border border-slate-900 bg-white px-5 py-2.5 text-xs font-bold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
              >
                {working ? 'Validating...' : 'Preview Rates & Validate CSV'}
              </button>
              <button
                type="button"
                onClick={handleBulkBook}
                disabled={working}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {working ? 'Booking Batch...' : 'Execute Batch Booking Now'}
              </button>
            </div>
          </div>

          {quotePreview && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card text-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-extrabold text-slate-900">
                  Batch Rate Estimate ({quotePreview.results.length} rows)
                  {quotePreview.hasCorporateRate && ' • Corporate Discount Applied'}
                </h3>
                <span className="font-mono text-base font-extrabold text-brand-700">
                  Estimated Total: ₹{quotePreview.totalAmount.toFixed(2)}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {quotePreview.results.map((r) => (
                  <div key={r.index} className={`rounded-xl border p-3 ${r.ok ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40'}`}>
                    <p className="font-bold text-slate-900">Row #{r.index + 1}</p>
                    {r.ok ? (
                      <p className="text-slate-700 mt-1">
                        {r.carrierCodes.join('+')} &bull; ₹{r.price.toFixed(2)} &bull; {r.etaDays}d
                      </p>
                    ) : (
                      <p className="text-red-700 mt-1">{r.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {bookResult && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 text-xs space-y-3">
              <h3 className="font-extrabold text-emerald-900 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                Batch Result: {bookResult.createdCount} Booked, {bookResult.failedCount} Failed
              </h3>
              <div className="grid gap-2 sm:grid-cols-3">
                {bookResult.created.map((c) => (
                  <Link
                    key={c.awb}
                    href={`/track?awb=${c.awb}`}
                    className="rounded-xl border border-emerald-200 bg-white p-3 hover:border-brand-600 transition"
                  >
                    <p className="font-mono font-bold text-slate-900">{c.awb}</p>
                    <p className="text-slate-500 mt-0.5">
                      {c.carrierMode} &bull; ₹{c.price}
                    </p>
                  </Link>
                ))}
                {bookResult.failed.map((f) => (
                  <div key={f.index} className="rounded-xl border border-red-200 bg-white p-3 text-red-700">
                    Row #{f.index + 1} ({f.recipientName}): {f.error}
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {tab === 'account' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card space-y-4 text-xs">
            <h2 className="text-base font-extrabold text-slate-900">Corporate Status &amp; Rate Contract</h2>
            {profile?.businessAccount ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 text-sm">{profile.businessAccount.legalName}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-bold ${
                      profile.businessAccount.isApproved ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {profile.businessAccount.isApproved ? 'APPROVED B2B' : 'PENDING REVIEW'}
                  </span>
                </div>
                <p className="text-slate-600">
                  GSTIN: <span className="font-mono font-bold text-slate-900">{profile.businessAccount.gstin ?? 'Not provided'}</span>
                </p>
                <p className="text-slate-600">
                  Postpaid Credit Limit: <strong className="font-mono text-slate-900">₹{profile.businessAccount.creditLimit.toLocaleString('en-IN')}</strong>
                </p>
                {profile.businessAccount.contracts.length > 0 && (
                  <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-3">
                    <p className="font-bold text-brand-800">Active Contract Rate</p>
                    <p className="text-brand-700 mt-1">
                      Multiplier: {profile.businessAccount.contracts[0].ruleJson?.slabMultiplier ?? 1} &bull;{' '}
                      {profile.businessAccount.contracts[0].ruleJson?.label ?? 'Negotiated B2B Rate'}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-slate-500">Submit your company legal name &amp; GSTIN on the right to unlock postpaid billing &amp; negotiated B2B slab discounts.</p>
            )}
          </div>

          <form onSubmit={handleApplyAccount} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card space-y-4 text-xs">
            <h2 className="text-base font-extrabold text-slate-900">Register / Update GSTIN Entity</h2>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Registered Legal Company Name</label>
              <input type="text" required value={legalName} onChange={(e) => setLegalName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Acme Commerce Pvt Ltd" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">GSTIN (Optional)</label>
              <input type="text" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono uppercase" placeholder="29AABCA1234K1Z5" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Requested Monthly Credit Line (₹)</label>
              <input type="number" min="0" value={creditReq} onChange={(e) => setCreditReq(Number(e.target.value))} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono" />
            </div>
            <button type="submit" className="rounded-xl bg-slate-900 px-5 py-2.5 font-bold text-white hover:bg-brand-600 transition">
              Save Corporate Details
            </button>
          </form>
        </motion.div>
      )}

      {tab === 'api' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 text-xs">
          <div className="grid gap-6 md:grid-cols-2">
            <form onSubmit={handleCreateKey} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card space-y-4">
              <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Plus className="h-4 w-4 text-brand-600" /> Generate E-Commerce / ONDC API Key
              </h2>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Integration Label</label>
                <input type="text" required value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">ONDC Subscriber ID (Optional)</label>
                <input type="text" value={ondcSubId} onChange={(e) => setOndcSubId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono" />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Webhook Callback URL (Optional HTTPS)</label>
                <input type="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://api.yourstore.com/webhooks/ondc" className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono" />
              </div>
              <button type="submit" className="rounded-xl bg-brand-600 px-5 py-2.5 font-bold text-white hover:bg-brand-700">
                Create API Key
              </button>
              {freshKey && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 font-mono text-[11px] break-all text-amber-950">
                  <strong>Plaintext Secret (shown once):</strong> {freshKey}
                </div>
              )}
            </form>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card space-y-3">
              <h2 className="text-base font-extrabold text-slate-900">Active Integrations &amp; Webhook Tester</h2>
              {webhookTestRes && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 font-mono text-[11px] text-indigo-900">
                  {webhookTestRes}
                </div>
              )}
              {(profile?.apiKeys ?? []).length === 0 ? (
                <p className="text-slate-500">No API keys created yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {profile!.apiKeys.map((k) => (
                    <div key={k.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-bold text-slate-900">{k.label}</p>
                        <p className="font-mono text-[11px] text-slate-500">
                          {k.keyPrefix}*** {k.ondcSubscriberId ? `• ONDC: ${k.ondcSubscriberId}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!token) return;
                            const r = await testPartnerWebhook(k.id, token);
                            setWebhookTestRes(`${r.detail} (HMAC Sig: ${r.signature.slice(0, 16)}...)`);
                          }}
                          className="rounded-lg border border-indigo-200 bg-white px-3 py-1 font-semibold text-indigo-700 hover:bg-indigo-50"
                        >
                          Test Webhook
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!token) return;
                            await deletePartnerApiKey(k.id, token);
                            await loadProfile(token);
                          }}
                          className="rounded-lg border border-red-200 bg-white p-1.5 text-red-600 hover:bg-red-50"
                          title="Revoke API Key"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

