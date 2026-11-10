'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  quote,
  createShipment,
  payShipment,
  listSavedAddresses,
  saveAddress,
  downloadShipmentLabel,
  downloadShipmentInvoice,
  validatePromo,
  getB2BProfile,
  RoutingOption,
  SavedAddress,
  B2BProfileDTO,
} from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  Package,
  MapPin,
  Truck,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  CreditCard,
  Bookmark,
  Clock,
  Printer,
  Receipt,
  ShieldCheck,
  Globe2,
  Tag,
  Banknote,
  Building2,
} from 'lucide-react';

const PICKUP_SLOTS = [
  { id: '09-11', label: 'Morning (09:00 – 11:00)', startH: 9, endH: 11 },
  { id: '11-13', label: 'Midday (11:00 – 13:00)', startH: 11, endH: 13 },
  { id: '14-17', label: 'Afternoon (14:00 – 17:00)', startH: 14, endH: 17 },
  { id: '17-19', label: 'Evening (17:00 – 19:00)', startH: 17, endH: 19 },
];

const COUNTRIES = [
  { code: 'IN', name: 'India (Domestic)' },
  { code: 'US', name: 'United States (US)' },
  { code: 'GB', name: 'United Kingdom (GB)' },
  { code: 'AE', name: 'United Arab Emirates (AE)' },
  { code: 'SG', name: 'Singapore (SG)' },
  { code: 'DE', name: 'Germany / EU (DE)' },
  { code: 'CA', name: 'Canada (CA)' },
  { code: 'AU', name: 'Australia (AU)' },
];

export default function BookCourierPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);

  // Saved Addresses & B2B status
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [b2bProfile, setB2bProfile] = useState<B2BProfileDTO | null>(null);
  const [savingAddrMsg, setSavingAddrMsg] = useState<string | null>(null);

  // Step 1 — Sender / Pickup
  const [fromPincode, setFromPincode] = useState('560001');
  const [senderName, setSenderName] = useState('Rahul Kumar');
  const [senderPhone, setSenderPhone] = useState('9000000010');
  const [senderLine1, setSenderLine1] = useState('12, Church Street');
  const [senderCity, setSenderCity] = useState('Bengaluru');
  const [senderState, setSenderState] = useState('Karnataka');

  // Step 2 — Destination & Country
  const [destinationCountry, setDestinationCountry] = useState('IN');
  const [toPincode, setToPincode] = useState('560038');
  const [recipientName, setRecipientName] = useState('Priya Menon');
  const [recipientPhone, setRecipientPhone] = useState('9000000011');
  const [recipientLine1, setRecipientLine1] = useState('45, Indiranagar 100ft Rd');
  const [recipientCity, setRecipientCity] = useState('Bengaluru');
  const [recipientState, setRecipientState] = useState('Karnataka');

  // Step 3 — Channel Separation, Service Tier, Cold-Chain Packaging & Compliance
  const [fulfillmentMode, setFulfillmentMode] = useState<'OWN' | 'PARTNER'>('OWN');
  const [serviceType, setServiceType] = useState<string>('LOCAL');
  const [parcelCount, setParcelCount] = useState(1);
  const [unitCount, setUnitCount] = useState(2);
  const [weightKg, setWeightKg] = useState(1.5);
  const [lengthCm, setLengthCm] = useState(24);
  const [widthCm, setWidthCm] = useState(18);
  const [heightCm, setHeightCm] = useState(8);
  const [packaging, setPackaging] = useState('CUSTOMER_PACKED');
  const [protectionOpted, setProtectionOpted] = useState(true);
  const [declaredValue, setDeclaredValue] = useState(1500);
  const [goodsDescription, setGoodsDescription] = useState('Personal documents / commercial books & electronics');
  const [ewayBillNumber, setEwayBillNumber] = useState('');
  const [prohibitedConfirmed, setProhibitedConfirmed] = useState(true);
  const [specialInstructions, setSpecialInstructions] = useState('');

  // Pickup Date/Slot + Payment + Promo
  const [pickupDate, setPickupDate] = useState(() => new Date(Date.now() + 864e5).toISOString().slice(0, 10));
  const [pickupSlotId, setPickupSlotId] = useState('11-13');
  const [paymentMethod, setPaymentMethod] = useState<'PREPAID' | 'COD' | 'CORPORATE_CREDIT'>('PREPAID');
  const [promoInput, setPromoInput] = useState('');
  const [promoFeedback, setPromoFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Quote & Booking State
  const [quoting, setQuoting] = useState(false);
  const [options, setOptions] = useState<RoutingOption[]>([]);
  const [hasCorporateRate, setHasCorporateRate] = useState(false);
  const [selectedOptionId, setSelectedOptionId] = useState<string>('');
  const [preferredOptionId, setPreferredOptionId] = useState<string>('');
  const [booking, setBooking] = useState(false);
  const [downloadingLabel, setDownloadingLabel] = useState(false);
  const [confirmedShipment, setConfirmedShipment] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = getToken();
    if (t) {
      listSavedAddresses(t).then(setSavedAddresses).catch(() => {});
      getB2BProfile(t).then(setB2bProfile).catch(() => {});
    }
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      if (p.get('from')) setFromPincode(p.get('from')!);
      if (p.get('to')) setToPincode(p.get('to')!);
      if (p.get('weight')) setWeightKg(Math.max(0.2, Number(p.get('weight')) || 1));
      if (p.get('mode') === 'PARTNER' || p.get('mode') === 'OWN') setFulfillmentMode(p.get('mode') as 'OWN' | 'PARTNER');
      if (p.get('service')) {
        const s = p.get('service')!;
        setServiceType(s);
        if (s === 'INTERNATIONAL' && !p.get('country')) setDestinationCountry('US');
      }
      if (p.get('country')) setDestinationCountry(p.get('country')!.toUpperCase());
      if (p.get('packaging')) setPackaging(p.get('packaging')!);
      if (p.get('promo')) setPromoInput(p.get('promo')!.toUpperCase());
      if (p.get('optionId')) setPreferredOptionId(p.get('optionId')!);
    }
  }, []);

  const applySavedAddress = (target: 'pickup' | 'delivery', addrId: string) => {
    const addr = savedAddresses.find((a) => a.id === addrId);
    if (!addr) return;
    if (target === 'pickup') {
      setSenderName(addr.name);
      setSenderPhone(addr.phone);
      setSenderLine1(addr.line1);
      setSenderCity(addr.city);
      setSenderState(addr.state);
      setFromPincode(addr.pincode);
    } else {
      setRecipientName(addr.name);
      setRecipientPhone(addr.phone);
      setRecipientLine1(addr.line1);
      setRecipientCity(addr.city);
      setRecipientState(addr.state);
      setToPincode(addr.pincode);
    }
  };

  const handleSaveCurrentAddress = async (target: 'pickup' | 'delivery') => {
    const token = getToken();
    if (!token) {
      setError('Sign in first to save addresses to your address book');
      return;
    }
    setSavingAddrMsg(null);
    setError(null);
    try {
      const payload =
        target === 'pickup'
          ? { name: senderName, phone: senderPhone, line1: senderLine1, city: senderCity, state: senderState, pincode: fromPincode }
          : { name: recipientName, phone: recipientPhone, line1: recipientLine1, city: recipientCity, state: recipientState, pincode: toPincode };
      const saved = await saveAddress(payload, token);
      setSavedAddresses((prev) => [...prev, saved]);
      setSavingAddrMsg(`Saved "${saved.name}" (${saved.pincode}) to address book!`);
    } catch (err: any) {
      setError(err?.message || 'Failed to save address');
    }
  };

  const handleCheckPromo = async () => {
    if (!promoInput.trim()) return;
    setPromoFeedback(null);
    try {
      const r = await validatePromo(promoInput.trim(), 300);
      setPromoFeedback({
        ok: r.valid,
        msg: r.valid ? `${r.code} valid: ${r.description}` : r.reason ?? 'Invalid promo code',
      });
    } catch (err: any) {
      setPromoFeedback({ ok: false, msg: err?.message || 'Promo check failed' });
    }
  };

  const buildPickupSlotIso = () => {
    const slot = PICKUP_SLOTS.find((s) => s.id === pickupSlotId) ?? PICKUP_SLOTS[0];
    const start = new Date(`${pickupDate}T${String(slot.startH).padStart(2, '0')}:00:00`);
    const end = new Date(`${pickupDate}T${String(slot.endH).padStart(2, '0')}:00:00`);
    return { pickupSlotStart: start.toISOString(), pickupSlotEnd: end.toISOString() };
  };

  const fetchQuote = async (overridePaymentMethod?: 'PREPAID' | 'COD' | 'CORPORATE_CREDIT') => {
    if (protectionOpted && (!declaredValue || Number(declaredValue) <= 0)) {
      setError('Please enter a positive declared value when parcel protection is enabled.');
      return;
    }
    if (!prohibitedConfirmed) {
      setError('Please confirm that the parcel contains no prohibited or hazardous items.');
      return;
    }
    const pm = overridePaymentMethod ?? paymentMethod;
    if (pm === 'COD' && destinationCountry !== 'IN') {
      setError('Cash on Delivery is only available for domestic India shipments.');
      return;
    }

    setQuoting(true);
    setError(null);
    try {
      const token = getToken() ?? undefined;
      const effectiveService = destinationCountry !== 'IN' ? 'INTERNATIONAL' : serviceType;
      const res = await quote(
        {
          fromPincode: fromPincode.trim(),
          toPincode: toPincode.trim(),
          serviceType: effectiveService,
          packaging,
          dims: {
            lengthCm: Number(lengthCm),
            widthCm: Number(widthCm),
            heightCm: Number(heightCm),
            actualWeightKg: Number(weightKg),
          },
          declaredValue: Number(declaredValue),
          protectionOpted,
          paymentMethod: pm,
          promoCode: promoInput.trim() || undefined,
          destinationCountry,
          fulfillmentMode: fulfillmentMode,
          ownOnly: fulfillmentMode === 'OWN',
        },
        token,
      );

      setHasCorporateRate(Boolean(res.hasCorporateRate));
      setOptions(res.options);
      if (res.options.length > 0) {
        const matched = preferredOptionId && res.options.find((o) => o.optionId === preferredOptionId);
        setSelectedOptionId(matched ? matched.optionId : res.options[0].optionId);
      } else {
        setError(
          fulfillmentMode === 'OWN'
            ? 'Own Courier Fleet does not cover one of these pincodes yet. Switch channel to "Partner Couriers (DTDC / Delhivery / BlueDart)" to quote nationwide!'
            : 'No carrier route available between these postal codes.',
        );
        return;
      }
      setStep(4);
    } catch (err: any) {
      setError(err?.message || 'Failed to calculate quote.');
    } finally {
      setQuoting(false);
    }
  };

  const handleBook = async () => {
    const token = getToken();
    if (!token) {
      router.push('/login?redirect=/book');
      return;
    }

    setBooking(true);
    setError(null);

    try {
      const { pickupSlotStart, pickupSlotEnd } = buildPickupSlotIso();
      const effectiveService = destinationCountry !== 'IN' ? 'INTERNATIONAL' : serviceType;
      const res = await createShipment(
        {
          optionId: selectedOptionId || (fulfillmentMode === 'OWN' ? 'opt-own' : 'opt-dtdc'),
          shipmentType: fulfillmentMode === 'PARTNER' ? 'PARTNER_DIRECT_SHIPMENT' : 'CUSTOMER_OWN_BOOK_SHIPMENT',
          fulfillmentMode,
          serviceType: effectiveService,
          packaging,
          bookCount: Number(unitCount) || 1,
          parcelCount: Number(parcelCount) || 1,
          declaredValue: Number(declaredValue),
          protectionOpted,
          paymentMethod,
          promoCode: promoInput.trim() || undefined,
          destinationCountry,
          ewayBillNumber: ewayBillNumber.trim() || undefined,
          prohibitedConfirmed,
          solutionCategory:
            packaging === 'TEMPERATURE_CONTROLLED'
              ? 'COLD_CHAIN'
              : fulfillmentMode === 'PARTNER'
              ? 'PARTNER_DIRECT'
              : 'PERSONAL_COURIER',
          goodsDescription: goodsDescription.trim() || undefined,
          specialInstructions: specialInstructions.trim() || undefined,
          fromPincode: fromPincode.trim(),
          toPincode: toPincode.trim(),
          pickupSlotStart,
          pickupSlotEnd,
          dims: {
            lengthCm: Number(lengthCm),
            widthCm: Number(widthCm),
            heightCm: Number(heightCm),
            actualWeightKg: Number(weightKg),
          },
          pickupAddress: {
            name: senderName,
            phone: senderPhone,
            line1: senderLine1,
            city: senderCity,
            state: senderState,
            pincode: fromPincode.trim(),
          },
          deliveryAddress: {
            name: recipientName,
            phone: recipientPhone,
            line1: recipientLine1,
            city: recipientCity,
            state: recipientState,
            pincode: toPincode.trim(),
          },
        },
        token,
      );

      if (paymentMethod === 'PREPAID') {
        await payShipment(res.shipment.id, token);
      }
      setConfirmedShipment(res.shipment);
    } catch (err: any) {
      setError(err?.message || 'Booking failed. Please verify inputs or switch payment method.');
    } finally {
      setBooking(false);
    }
  };

  const handleDownloadLabel = async () => {
    const token = getToken();
    if (!token || !confirmedShipment) return;
    setDownloadingLabel(true);
    setError(null);
    try {
      await downloadShipmentLabel(confirmedShipment.id, confirmedShipment.awb, token);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate shipping label');
    } finally {
      setDownloadingLabel(false);
    }
  };

  const selectedOption = options.find((o) => o.optionId === selectedOptionId) ?? options[0];
  const estVolumetricKg = ((Number(lengthCm) * Number(widthCm) * Number(heightCm)) / 5000).toFixed(2);
  const selectedSlotLabel = PICKUP_SLOTS.find((s) => s.id === pickupSlotId)?.label ?? '';
  const hasApprovedCorporateCredit = Boolean(b2bProfile?.businessAccount?.isApproved);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 border border-brand-200 px-3 py-1 text-[11px] font-bold text-brand-700">
          <Package className="h-3.5 w-3.5" /> Multi-Channel Courier Booking Studio
        </span>
        <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
          Book Domestic, Express or Global <span className="text-brand-600">Courier</span>
        </h1>
        <p className="mt-1 text-xs text-slate-600">
          Switch cleanly between Own Verified Fleet and Pre-Existing Partners (DTDC, Delhivery, BlueDart) with live promo &amp; COD pricing.
        </p>
      </div>

      {/* Stepper */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs">
        {['Pickup', 'Destination', 'Channel & Parcel', 'Quote & Pay'].map((name, i) => {
          const stepNum = i + 1;
          const isCurrent = step === stepNum && !confirmedShipment;
          const isDone = step > stepNum || Boolean(confirmedShipment);
          return (
            <div key={name} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition ${
                  isDone
                    ? 'bg-emerald-600 text-white'
                    : isCurrent
                    ? 'bg-brand-600 text-white ring-4 ring-brand-100'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {stepNum}
              </span>
              <span className={`font-semibold ${isCurrent ? 'text-slate-900' : 'text-slate-500'}`}>{name}</span>
              {i < 3 && <div className="hidden sm:block h-0.5 w-6 bg-slate-200" />}
            </div>
          );
        })}
      </div>

      {savingAddrMsg && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
          {savingAddrMsg}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-xl bg-red-50 p-3.5 text-xs font-semibold text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {confirmedShipment ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-8 text-center shadow-card"
        >
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
          <h2 className="mt-3 text-xl font-extrabold text-slate-900">Courier Booking Confirmed!</h2>
          <p className="mt-1 text-xs text-slate-600">
            Pickup scheduled for {pickupDate} ({selectedSlotLabel}) &bull; Payment mode: <strong>{paymentMethod}</strong>
          </p>

          <div className="mx-auto mt-6 max-w-md rounded-xl border border-slate-200 bg-white p-5 text-left space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Assigned Airway Bill (AWB)
            </span>
            <p className="text-xl font-mono font-extrabold text-slate-900">{confirmedShipment.awb}</p>
            {confirmedShipment.legs?.[0]?.externalAwb && (
              <p className="text-xs text-indigo-700 font-semibold">
                External Partner Reference: <span className="font-mono">{confirmedShipment.legs[0].externalAwb}</span>
              </p>
            )}
            <p className="text-xs text-slate-500">
              Status: <span className="font-bold text-brand-700">{confirmedShipment.status}</span>
            </p>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={handleDownloadLabel}
              disabled={downloadingLabel}
              className="flex items-center gap-1.5 rounded-xl border border-indigo-300 bg-indigo-50 px-5 py-2.5 text-xs font-bold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              {downloadingLabel ? 'Generating PDF...' : 'A5 Label PDF'}
            </button>
            <button
              type="button"
              onClick={() => {
                const token = getToken();
                if (token && confirmedShipment) {
                  downloadShipmentInvoice(confirmedShipment.id, confirmedShipment.awb, token).catch((e) =>
                    setError(e?.message || 'Failed to generate invoice'),
                  );
                }
              }}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-2.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
            >
              <Receipt className="h-4 w-4" /> GST Tax Invoice PDF
            </button>
            <Link
              href={`/track?awb=${confirmedShipment.awb}`}
              className="rounded-xl bg-brand-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-brand-700"
            >
              Open Live Tracking
            </Link>
            <Link
              href="/orders"
              className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              My Shipments
            </Link>
          </div>
        </motion.div>
      ) : (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-brand-600" /> Sender &amp; Pickup Details
                  </h2>
                  <button
                    type="button"
                    onClick={() => handleSaveCurrentAddress('pickup')}
                    className="flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <Bookmark className="h-3 w-3" /> Save Address
                  </button>
                </div>

                {savedAddresses.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <label className="block font-semibold text-slate-600 mb-1">Fill from Saved Address Book:</label>
                    <select
                      defaultValue=""
                      onChange={(e) => applySavedAddress('pickup', e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                    >
                      <option value="">-- Choose saved pickup address --</option>
                      {savedAddresses.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} — {a.line1}, {a.city} ({a.pincode})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-700 font-semibold">Sender Name</label>
                    <input type="text" value={senderName} onChange={(e) => setSenderName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold">Sender Phone</label>
                    <input type="text" value={senderPhone} onChange={(e) => setSenderPhone(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </div>
                </div>
                <div className="text-xs">
                  <label className="block text-slate-700 font-semibold">Pickup Street Address</label>
                  <input type="text" value={senderLine1} onChange={(e) => setSenderLine1(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-700 font-semibold">Pickup Pincode</label>
                    <input type="text" value={fromPincode} onChange={(e) => setFromPincode(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-bold" />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold">City</label>
                    <input type="text" value={senderCity} onChange={(e) => setSenderCity(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold">State</label>
                    <input type="text" value={senderState} onChange={(e) => setSenderState(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </div>
                </div>
                <div className="pt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-brand-600 px-6 py-2 text-xs font-bold text-white hover:bg-brand-700"
                  >
                    Next: Destination Details <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <Globe2 className="h-4 w-4 text-brand-600" /> Recipient &amp; Destination
                  </h2>
                  <button
                    type="button"
                    onClick={() => handleSaveCurrentAddress('delivery')}
                    className="flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <Bookmark className="h-3 w-3" /> Save Address
                  </button>
                </div>

                {savedAddresses.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <label className="block font-semibold text-slate-600 mb-1">Fill from Saved Address Book:</label>
                    <select
                      defaultValue=""
                      onChange={(e) => applySavedAddress('delivery', e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                    >
                      <option value="">-- Choose saved recipient address --</option>
                      {savedAddresses.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} — {a.line1}, {a.city} ({a.pincode})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-700 font-semibold">Destination Country</label>
                    <select
                      value={destinationCountry}
                      onChange={(e) => {
                        const c = e.target.value;
                        setDestinationCountry(c);
                        if (c !== 'IN') {
                          setServiceType('INTERNATIONAL');
                          if (toPincode === '560038') setToPincode('10001');
                          if (recipientCity === 'Bengaluru') {
                            setRecipientCity(c === 'US' ? 'New York' : c === 'GB' ? 'London' : c === 'AE' ? 'Dubai' : 'International Hub');
                            setRecipientState(c);
                          }
                        } else if (serviceType === 'INTERNATIONAL') {
                          setServiceType('LOCAL');
                        }
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold"
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold">Recipient Name</label>
                    <input type="text" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold">Recipient Phone</label>
                    <input type="text" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </div>
                </div>
                <div className="text-xs">
                  <label className="block text-slate-700 font-semibold">Delivery Address Line</label>
                  <input type="text" value={recipientLine1} onChange={(e) => setRecipientLine1(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-700 font-semibold">
                      {destinationCountry === 'IN' ? 'Delivery Pincode' : 'ZIP / Postal Code'}
                    </label>
                    <input type="text" value={toPincode} onChange={(e) => setToPincode(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-bold" />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold">City</label>
                    <input type="text" value={recipientCity} onChange={(e) => setRecipientCity(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold">State / Province</label>
                    <input type="text" value={recipientState} onChange={(e) => setRecipientState(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </div>
                </div>
                <div className="pt-4 flex justify-between">
                  <button type="button" onClick={() => setStep(1)} className="flex items-center gap-1 rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </button>
                  <button type="button" onClick={() => setStep(3)} className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-brand-600 px-6 py-2 text-xs font-bold text-white hover:bg-brand-700">
                    Next: Channel, Parcel &amp; Tier <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-4"
              >
                <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <Package className="h-4 w-4 text-brand-600" /> Carrier Channel, Service Tier &amp; Parcel
                </h2>

                {/* Separated Fulfillment Mode Selector */}
                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setFulfillmentMode('OWN')}
                    className={`rounded-xl border-2 p-3.5 text-left transition ${
                      fulfillmentMode === 'OWN' ? 'border-brand-600 bg-brand-50/50' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <p className="font-bold text-slate-900 flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-brand-600" /> Own Courier Fleet (Direct)
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-600">Our uniformed agents pick up &amp; deliver with mandatory 6-digit OTP.</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFulfillmentMode('PARTNER')}
                    className={`rounded-xl border-2 p-3.5 text-left transition ${
                      fulfillmentMode === 'PARTNER' ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <p className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Truck className="h-4 w-4 text-indigo-600" /> Pre-Existing Partner Network (3P)
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-600">Compare &amp; dispatch via DTDC Express, Delhivery Direct, or BlueDart Air.</p>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-700 font-semibold">Service Tier</label>
                    <select
                      value={destinationCountry !== 'IN' ? 'INTERNATIONAL' : serviceType}
                      onChange={(e) => setServiceType(e.target.value)}
                      disabled={destinationCountry !== 'IN'}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 font-semibold"
                    >
                      <option value="LOCAL">Local Standard (City)</option>
                      <option value="EXPRESS">Express Parcel</option>
                      <option value="EXPRESS_PREMIUM">Express Premium (Next-Day)</option>
                      <option value="AIRMAX">AirMax Priority Air Cargo</option>
                      <option value="INTERCITY">Intercity Surface</option>
                      <option value="HYPERLOCAL">Hyperlocal Rapid (Same-Day)</option>
                      <option value="LTL_FREIGHT">LTL / Part Truckload Freight</option>
                      <option value="FTL_FREIGHT">Full Truckload (FTL Charter)</option>
                      <option value="INTERNATIONAL">International Shipping</option>
                      <option value="SCHEDULED">Scheduled Slot Delivery</option>
                      <option value="RETURN">Reverse Pickup (Return)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold">Parcels / Boxes</label>
                    <div className="mt-1 grid grid-cols-2 gap-1.5">
                      <input type="number" min="1" value={parcelCount} onChange={(e) => setParcelCount(Number(e.target.value))} title="Parcel Count" className="w-full rounded-lg border border-slate-300 px-2.5 py-2" />
                      <input type="number" min="1" value={unitCount} onChange={(e) => setUnitCount(Number(e.target.value))} title="Item Units" className="w-full rounded-lg border border-slate-300 px-2.5 py-2" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold">Actual Weight (kg)</label>
                    <input type="number" step="0.1" min="0.1" value={weightKg} onChange={(e) => setWeightKg(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-bold" />
                  </div>
                </div>

                <div className="text-xs">
                  <div className="flex items-center justify-between">
                    <label className="block text-slate-700 font-semibold">Box Dimensions (L &times; W &times; H cm)</label>
                    <span className="text-[11px] text-slate-500">
                      Volumetric Wt: <strong>{estVolumetricKg} kg</strong> (L&times;W&times;H / 5000)
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    <input type="number" value={lengthCm} onChange={(e) => setLengthCm(Number(e.target.value))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-center" />
                    <input type="number" value={widthCm} onChange={(e) => setWidthCm(Number(e.target.value))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-center" />
                    <input type="number" value={heightCm} onChange={(e) => setHeightCm(Number(e.target.value))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-center" />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-700 font-semibold">Packaging &amp; Handling Tier</label>
                    <select value={packaging} onChange={(e) => setPackaging(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold">
                      <option value="CUSTOMER_PACKED">Self Packed (₹0)</option>
                      <option value="COMPANY_PACKED">Company Tamper-Proof Box</option>
                      <option value="COMPANY_PACKED_FRAGILE">Fragile Reinforced Casing</option>
                      <option value="TEMPERATURE_CONTROLLED">Cold-Chain / Temperature Controlled</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold">Declared Parcel Value (₹)</label>
                    <input type="number" min="0" value={declaredValue} onChange={(e) => setDeclaredValue(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono" />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-700 font-semibold">Contents / Goods Description</label>
                    <input type="text" value={goodsDescription} onChange={(e) => setGoodsDescription(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold">
                      E-Way Bill No. {Number(declaredValue) >= 50000 ? '(Recommended ≥ ₹50,000)' : '(Optional)'}
                    </label>
                    <input
                      type="text"
                      value={ewayBillNumber}
                      onChange={(e) => setEwayBillNumber(e.target.value)}
                      placeholder="12-digit E-Way Bill ref"
                      className={`mt-1 w-full rounded-lg border px-3 py-2 font-mono ${
                        Number(declaredValue) >= 50000 ? 'border-amber-400 bg-amber-50/40' : 'border-slate-300'
                      }`}
                    />
                  </div>
                </div>

                {/* Pickup Slot */}
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3.5 text-xs">
                  <p className="flex items-center gap-1.5 font-bold text-indigo-900 mb-2">
                    <Clock className="h-3.5 w-3.5 text-indigo-600" /> Doorstep Pickup Window
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5" />
                    <select value={pickupSlotId} onChange={(e) => setPickupSlotId(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5">
                      {PICKUP_SLOTS.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Promo Coupon Bar */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-2">
                  <label className="font-bold text-slate-700 flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-express-600" /> Promo Code / Discount Coupon
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={promoInput}
                      onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                      placeholder="Try SHIP25 or EXPRESS15"
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono font-bold uppercase"
                    />
                    <button
                      type="button"
                      onClick={handleCheckPromo}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 font-bold text-slate-700 hover:bg-slate-100"
                    >
                      Apply
                    </button>
                  </div>
                  {promoFeedback && (
                    <p className={`text-[11px] font-semibold ${promoFeedback.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                      {promoFeedback.msg}
                    </p>
                  )}
                </div>

                {/* Compliance Checkboxes */}
                <div className="space-y-2 pt-1 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={protectionOpted} onChange={(e) => setProtectionOpted(e.target.checked)} className="rounded text-brand-600" />
                    <span className="font-medium text-slate-700">Include Parcel Protection &amp; Transit Insurance (1% of declared value)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={prohibitedConfirmed} onChange={(e) => setProhibitedConfirmed(e.target.checked)} className="rounded text-brand-600" />
                    <span className="font-medium text-slate-700">I confirm contents exclude hazardous, flammable, currency, or prohibited items.</span>
                  </label>
                </div>

                <div className="pt-4 flex justify-between">
                  <button type="button" onClick={() => setStep(2)} className="flex items-center gap-1 rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </button>
                  <button
                    type="button"
                    onClick={() => fetchQuote()}
                    disabled={quoting}
                    className="min-h-[42px] rounded-xl bg-brand-600 px-6 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {quoting ? 'Calculating Live Rates...' : 'View Carrier Quote & Breakdown'}
                  </button>
                </div>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <Truck className="h-4 w-4 text-brand-600" /> Choose Carrier &amp; Payment Method
                  </h2>
                  {hasCorporateRate && (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                      B2B Contract Discount Active
                    </span>
                  )}
                </div>

                {/* Payment Method Tabs */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentMethod('PREPAID');
                      fetchQuote('PREPAID');
                    }}
                    className={`rounded-xl border-2 p-3 text-left transition ${
                      paymentMethod === 'PREPAID' ? 'border-brand-600 bg-brand-50/60' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <p className="font-bold text-slate-900 flex items-center gap-1.5">
                      <CreditCard className="h-3.5 w-3.5 text-brand-600" /> Prepaid Online
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">UPI / Cards / Razorpay</p>
                  </button>

                  {destinationCountry === 'IN' && (
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentMethod('COD');
                        fetchQuote('COD');
                      }}
                      className={`rounded-xl border-2 p-3 text-left transition ${
                        paymentMethod === 'COD' ? 'border-rose-600 bg-rose-50/50' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <p className="font-bold text-slate-900 flex items-center gap-1.5">
                        <Banknote className="h-3.5 w-3.5 text-rose-600" /> Cash on Delivery (COD)
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Collect cash upon handover</p>
                    </button>
                  )}

                  {hasApprovedCorporateCredit && (
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentMethod('CORPORATE_CREDIT');
                        fetchQuote('CORPORATE_CREDIT');
                      }}
                      className={`rounded-xl border-2 p-3 text-left transition ${
                        paymentMethod === 'CORPORATE_CREDIT' ? 'border-slate-900 bg-slate-100' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <p className="font-bold text-slate-900 flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-slate-800" /> Corporate Credit Line
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Limit ₹{b2bProfile?.businessAccount?.creditLimit.toLocaleString('en-IN')}</p>
                    </button>
                  )}
                </div>

                {/* Carrier Options */}
                <div className="space-y-2.5">
                  {options.map((opt) => (
                    <label
                      key={opt.optionId}
                      className={`block cursor-pointer rounded-xl border-2 p-4 transition ${
                        selectedOptionId === opt.optionId
                          ? 'border-brand-600 bg-brand-50/40'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="option"
                            checked={selectedOptionId === opt.optionId}
                            onChange={() => setSelectedOptionId(opt.optionId)}
                            className="text-brand-600 focus:ring-brand-600"
                          />
                          <div>
                            <p className="font-bold text-slate-900 text-sm">{opt.carrierTypeLabel}</p>
                            <p className="text-xs text-slate-500">
                              ETA ~{opt.etaDays} day(s) &bull; {destinationCountry !== 'IN' ? `INTL (${destinationCountry})` : serviceType.replace(/_/g, ' ')}
                            </p>
                          </div>
                        </div>
                        <p className="font-mono text-lg font-extrabold text-brand-700 tabular-nums">
                          ₹{opt.price.toFixed(2)}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>

                {selectedOption?.breakdown && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-2">
                    <div className="flex flex-wrap items-center justify-between border-b border-slate-200 pb-2 font-bold text-slate-900">
                      <span className="flex items-center gap-1.5">
                        <Receipt className="h-4 w-4 text-brand-600" />
                        Itemized Charge Breakdown ({selectedOption.breakdown.slab.originZone} &rarr; {selectedOption.breakdown.slab.destZone})
                      </span>
                      <span className="text-slate-600 font-normal">
                        Chargeable Wt: <strong>{selectedOption.breakdown.chargeableWeightKg} kg</strong>
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-y-1.5 text-slate-700">
                      <span>Base Freight</span>
                      <span className="text-right font-mono">₹{selectedOption.breakdown.base.toFixed(2)}</span>

                      {selectedOption.breakdown.pickupFee > 0 && (
                        <>
                          <span>Doorstep Pickup</span>
                          <span className="text-right font-mono">₹{selectedOption.breakdown.pickupFee.toFixed(2)}</span>
                        </>
                      )}

                      <span>Packaging ({packaging.replace(/_/g, ' ')})</span>
                      <span className="text-right font-mono">₹{selectedOption.breakdown.packagingFee.toFixed(2)}</span>

                      <span>Parcel Protection Insurance</span>
                      <span className="text-right font-mono">₹{selectedOption.breakdown.protectionFee.toFixed(2)}</span>

                      {(selectedOption.breakdown.codFee ?? 0) > 0 && (
                        <>
                          <span>Cash on Delivery (COD) Handling</span>
                          <span className="text-right font-mono">₹{(selectedOption.breakdown.codFee ?? 0).toFixed(2)}</span>
                        </>
                      )}

                      {(selectedOption.breakdown.promoDiscount ?? 0) > 0 && (
                        <>
                          <span className="text-emerald-700 font-semibold">
                            Promo Discount ({selectedOption.breakdown.appliedPromoCode})
                          </span>
                          <span className="text-right font-mono font-bold text-emerald-700">
                            -₹{(selectedOption.breakdown.promoDiscount ?? 0).toFixed(2)}
                          </span>
                        </>
                      )}

                      <span className="border-t border-slate-200 pt-1">
                        GST ({Math.round(selectedOption.breakdown.taxRate * 100)}%)
                      </span>
                      <span className="border-t border-slate-200 pt-1 text-right font-mono">
                        ₹{selectedOption.breakdown.tax.toFixed(2)}
                      </span>

                      <span className="border-t border-slate-300 pt-1.5 text-sm font-extrabold text-slate-900">
                        Total Payable ({paymentMethod})
                      </span>
                      <span className="border-t border-slate-300 pt-1.5 text-right font-mono text-base font-extrabold text-brand-700">
                        ₹{selectedOption.breakdown.total.toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                <div className="pt-2 flex justify-between">
                  <button type="button" onClick={() => setStep(3)} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600">
                    <ArrowLeft className="h-3.5 w-3.5 inline mr-1" /> Back
                  </button>
                  <button
                    type="button"
                    onClick={handleBook}
                    disabled={booking}
                    className="flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
                  >
                    <CreditCard className="h-4 w-4" />
                    {booking
                      ? 'Processing Booking...'
                      : paymentMethod === 'PREPAID'
                      ? 'Confirm & Pay Now'
                      : `Confirm ${paymentMethod.replace(/_/g, ' ')} Booking`}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
