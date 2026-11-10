'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  listHubs,
  createHub,
  createVehicle,
  getHubInventory,
  hubScanIn,
  hubScanOut,
  listManifests,
  createManifest,
  addManifestItems,
  removeManifestItem,
  closeManifest,
  HubSummary,
  VehicleSummary,
  HubInventoryItem,
  ManifestSummary,
} from '@/lib/api';
import { useAuthSession } from '@/hooks/useAuthSession';
import { AccessRestricted } from '@/components/AccessRestricted';
import {
  Warehouse,
  ScanBarcode,
  Truck,
  Package,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Send,
  Trash2,
  RefreshCw,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react';

export default function HubsPage() {
  const session = useAuthSession({ redirectIfUnauth: true });
  const token = session.token;
  const caps = session.capabilities;

  const [hubs, setHubs] = useState<HubSummary[]>([]);
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedHubId, setSelectedHubId] = useState<string>('');

  const [inventory, setInventory] = useState<HubInventoryItem[]>([]);
  const [recentScans, setRecentScans] = useState<
    Array<{
      id: string;
      awb: string;
      direction: string;
      conditionNote?: string | null;
      scannedAt: string;
      shipmentStatus?: string | null;
    }>
  >([]);
  const [manifests, setManifests] = useState<ManifestSummary[]>([]);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hub Scan form
  const [scanCode, setScanCode] = useState('');
  const [conditionNote, setConditionNote] = useState('');
  const [hubRole, setHubRole] = useState<'' | 'ORIGIN' | 'DESTINATION'>('');
  const [scanning, setScanning] = useState(false);

  // Create Manifest form
  const [manifestDest, setManifestDest] = useState('Chennai Guindy Hub');
  const [manifestVehicleId, setManifestVehicleId] = useState('');
  const [addItemInputs, setAddItemInputs] = useState<Record<string, string>>({});

  // Create Hub / Vehicle forms
  const [showAddInfra, setShowAddInfra] = useState(false);
  const [newHubName, setNewHubName] = useState('');
  const [newHubAddr, setNewHubAddr] = useState('');
  const [newHubCityId, setNewHubCityId] = useState('');
  const [newVehReg, setNewVehReg] = useState('');
  const [newVehType, setNewVehType] = useState('Mini Van');
  const [newVehCap, setNewVehCap] = useState(800);

  useEffect(() => {
    if (session.loading || !session.token) return;
    if (!caps.canViewHubsPortal) {
      setLoading(false);
      return;
    }
    loadAll(session.token);
  }, [session.loading, session.token, caps.canViewHubsPortal, caps.canManageHubsAndManifests]);

  const loadAll = async (t: string, hubOverride?: string) => {
    setLoading(true);
    setError(null);
    try {
      const [hubData, manData] = await Promise.all([
        listHubs(t),
        caps.canManageHubsAndManifests ? listManifests(t) : Promise.resolve([]),
      ]);
      setHubs(hubData.hubs);
      setVehicles(hubData.vehicles);
      setCities(hubData.cities);
      setManifests(manData);

      if (hubData.cities.length > 0 && !newHubCityId) {
        setNewHubCityId(hubData.cities[0].id);
      }

      const activeHubId = hubOverride || selectedHubId || hubData.hubs[0]?.id || '';
      if (activeHubId) {
        setSelectedHubId(activeHubId);
        if (caps.canManageHubsAndManifests) {
          const inv = await getHubInventory(activeHubId, t);
          setInventory(inv.inventory);
          setRecentScans(inv.recentScans);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load Hub Operations console');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectHub = async (hubId: string) => {
    setSelectedHubId(hubId);
    if (!token || !hubId || !caps.canManageHubsAndManifests) return;
    try {
      const inv = await getHubInventory(hubId, token);
      setInventory(inv.inventory);
      setRecentScans(inv.recentScans);
    } catch (err: any) {
      setError(err?.message || 'Failed to load hub inventory');
    }
  };

  const handleScan = async (direction: 'IN' | 'OUT') => {
    if (!token || !selectedHubId || !scanCode.trim()) return;
    setScanning(true);
    setError(null);
    setMessage(null);
    try {
      if (direction === 'IN') {
        const res = await hubScanIn(
          selectedHubId,
          {
            code: scanCode.trim(),
            conditionNote: conditionNote.trim() || undefined,
            hubRole: hubRole || undefined,
          },
          token,
        );
        setMessage(
          `Scanned IN [${res.awb}] — Shipment status: ${res.shipmentStatus}${res.statusChanged ? ' (updated)' : ''}`,
        );
      } else {
        const res = await hubScanOut(
          selectedHubId,
          { code: scanCode.trim(), conditionNote: conditionNote.trim() || undefined },
          token,
        );
        setMessage(`Scanned OUT [${res.awb}] recorded at hub.`);
      }
      setScanCode('');
      setConditionNote('');
      await loadAll(token, selectedHubId);
    } catch (err: any) {
      setError(err?.message || `Hub Scan ${direction} failed`);
    } finally {
      setScanning(false);
    }
  };

  const handleCreateManifest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedHubId || !manifestDest.trim()) return;
    setError(null);
    setMessage(null);
    try {
      const m = await createManifest(
        {
          originHubId: selectedHubId,
          destinationLabel: manifestDest.trim(),
          vehicleId: manifestVehicleId || undefined,
        },
        token,
      );
      setMessage(`Manifest ${m.code} opened!`);
      await loadAll(token, selectedHubId);
    } catch (err: any) {
      setError(err?.message || 'Failed to create manifest');
    }
  };

  const handleAddManifestItem = async (manifestId: string, code: string) => {
    if (!token || !code.trim()) return;
    setError(null);
    setMessage(null);
    try {
      const res = await addManifestItems(manifestId, [code.trim()], token);
      setMessage(`Added ${res.added.join(', ')} to manifest.`);
      setAddItemInputs((p) => ({ ...p, [manifestId]: '' }));
      await loadAll(token, selectedHubId);
    } catch (err: any) {
      setError(err?.message || 'Failed to add shipment to manifest');
    }
  };

  const handleRemoveManifestItem = async (manifestId: string, shipmentId: string) => {
    if (!token) return;
    setError(null);
    try {
      await removeManifestItem(manifestId, shipmentId, token);
      await loadAll(token, selectedHubId);
    } catch (err: any) {
      setError(err?.message || 'Failed to remove item from manifest');
    }
  };

  const handleCloseManifest = async (manifestId: string) => {
    if (!token) return;
    setError(null);
    setMessage(null);
    try {
      const res = await closeManifest(manifestId, token);
      setMessage(
        `Manifest ${res.manifest.code} CLOSED! Dispatched ${res.dispatched.length} parcel(s) -> IN_TRANSIT.`,
      );
      await loadAll(token, selectedHubId);
    } catch (err: any) {
      setError(err?.message || 'Failed to close manifest');
    }
  };

  const handleCreateInfra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    try {
      if (newHubName.trim() && newHubAddr.trim() && newHubCityId) {
        await createHub({ name: newHubName.trim(), address: newHubAddr.trim(), cityId: newHubCityId }, token);
        setNewHubName('');
        setNewHubAddr('');
      }
      if (newVehReg.trim() && newHubCityId) {
        await createVehicle(
          { regNo: newVehReg.trim(), type: newVehType, capacityKg: Number(newVehCap) || 800, cityId: newHubCityId },
          token,
        );
        setNewVehReg('');
      }
      setShowAddInfra(false);
      await loadAll(token, selectedHubId);
      setMessage('Infrastructure updated');
    } catch (err: any) {
      setError(err?.message || 'Failed to save hub/vehicle');
    }
  };

  const openManifestAtHub = manifests.find(
    (m) => m.status === 'OPEN' && m.originHubId === selectedHubId,
  );

  if (session.loading) {
    return <div className="py-12 text-center text-xs text-slate-500">Checking session permissions...</div>;
  }
  if (!caps.canViewHubsPortal) {
    return (
      <AccessRestricted
        roleLabel={caps.label}
        requiredLabel="Hub Managers, Operations Staff, or Field Agents"
        fallbackHref={caps.defaultHome}
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Warehouse className="h-6 w-6 text-indigo-600" />
            {caps.canManageHubsAndManifests
              ? 'Sorting Hubs & Linehaul Manifests (Phase 6)'
              : 'Hub Gate Parcel Scanner'}
          </h1>
          <p className="text-sm text-slate-600">
            {caps.canManageHubsAndManifests
              ? 'Scan parcels into/out of sorting hubs, monitor hub ageing, and dispatch vehicle manifests.'
              : 'Scan parcels IN or OUT when handing off or picking up shipments at a sorting hub.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedHubId}
            onChange={(e) => handleSelectHub(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
          >
            {hubs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} ({h.cityName})
              </option>
            ))}
          </select>

          {(caps.canCreateHub || caps.canCreateVehicle) && (
            <button
              onClick={() => setShowAddInfra((v) => !v)}
              className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Hub / Vehicle
            </button>
          )}

          <button
            onClick={() => token && loadAll(token, selectedHubId)}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Messages */}
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

      {/* Optional Add Hub / Vehicle Drawer */}
      {showAddInfra && (caps.canCreateHub || caps.canCreateVehicle) && (
        <form
          onSubmit={handleCreateInfra}
          className="mb-6 grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2"
        >
          {caps.canCreateHub && (
            <div>
              <h3 className="text-sm font-bold text-slate-900">Register New Hub</h3>
              <div className="mt-2 space-y-2">
                <select
                  value={newHubCityId}
                  onChange={(e) => setNewHubCityId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                >
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Hub Name (e.g. Bengaluru South Hub)"
                  value={newHubName}
                  onChange={(e) => setNewHubName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
                <input
                  type="text"
                  placeholder="Hub Street Address"
                  value={newHubAddr}
                  onChange={(e) => setNewHubAddr(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
                {!caps.canCreateVehicle && (
                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      Save Hub
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {caps.canCreateVehicle && (
            <div>
              <h3 className="text-sm font-bold text-slate-900">Register Fleet Vehicle</h3>
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  placeholder="Reg No (e.g. KA-01-BC-3003)"
                  value={newVehReg}
                  onChange={(e) => setNewVehReg(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm uppercase"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Type (Mini Van)"
                    value={newVehType}
                    onChange={(e) => setNewVehType(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    placeholder="Kg"
                    value={newVehCap}
                    onChange={(e) => setNewVehCap(Number(e.target.value))}
                    className="w-24 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Save Entries
                  </button>
                </div>
              </div>
            </div>
          )}
        </form>
      )}

      {/* Hub Gate Barcode Scanner */}
      <section className="mb-8 rounded-xl border border-indigo-200 bg-indigo-50/60 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5 text-indigo-600" />
            <h2 className="text-base font-semibold text-indigo-950">Hub Gate Scanner</h2>
          </div>
          <span className="text-xs text-indigo-700">
            PICKED_UP &rarr; AT_ORIGIN_HUB &bull; IN_TRANSIT &rarr; AT_DESTINATION_HUB
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-12">
          <input
            type="text"
            value={scanCode}
            onChange={(e) => setScanCode(e.target.value)}
            placeholder="Scan AWB or Package Barcode (BC...)"
            className="sm:col-span-4 rounded-lg border border-indigo-200 bg-white px-3 py-2 font-mono text-sm uppercase"
          />
          <input
            type="text"
            value={conditionNote}
            onChange={(e) => setConditionNote(e.target.value)}
            placeholder="Condition note (optional, e.g. Seal intact)"
            className="sm:col-span-3 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"
          />
          <select
            value={hubRole}
            onChange={(e) => setHubRole(e.target.value as '' | 'ORIGIN' | 'DESTINATION')}
            className="sm:col-span-2 rounded-lg border border-indigo-200 bg-white px-2.5 py-2 text-xs text-slate-700"
          >
            <option value="">Auto Hub Role</option>
            <option value="ORIGIN">Origin Hub</option>
            <option value="DESTINATION">Destination Hub</option>
          </select>
          <div className="sm:col-span-3 flex gap-2">
            <button
              type="button"
              disabled={scanning || !scanCode.trim()}
              onClick={() => handleScan('IN')}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <ArrowDownLeft className="h-3.5 w-3.5" />
              Scan IN
            </button>
            <button
              type="button"
              disabled={scanning || !scanCode.trim()}
              onClick={() => handleScan('OUT')}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              Scan OUT
            </button>
          </div>
        </div>
      </section>

      {caps.canManageHubsAndManifests ? (
      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left 7 cols: Current Hub Floor Inventory + Manifest Dispatch */}
        <div className="space-y-8 lg:col-span-7">
          {/* Hub Floor Inventory */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <Package className="h-4 w-4 text-slate-600" />
                Hub Floor Inventory ({inventory.length})
              </h2>
              <span className="text-xs text-slate-500">Checked IN awaiting dispatch/delivery</span>
            </div>

            {loading ? (
              <p className="py-6 text-center text-sm text-slate-500">Loading hub inventory...</p>
            ) : inventory.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500">
                No parcels currently checked in at this hub. Scan an AWB above to receive parcels.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {inventory.map((item) => (
                  <div key={item.shipmentId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/track?awb=${item.awb}`}
                          className="font-mono text-sm font-bold text-indigo-600 hover:underline"
                        >
                          {item.awb}
                        </Link>
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                          {item.status}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-amber-700">
                          <Clock className="h-3 w-3" /> {item.ageingHours}h in hub
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {item.serviceType} &bull; {item.bookCount} book(s)
                        {item.conditionNote ? ` • "${item.conditionNote}"` : ''}
                      </p>
                    </div>

                    {openManifestAtHub && (
                      <button
                        onClick={() => handleAddManifestItem(openManifestAtHub.id, item.awb)}
                        className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                      >
                        + Add to {openManifestAtHub.code}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Vehicle Manifests */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Truck className="h-5 w-5 text-indigo-600" />
              <h2 className="text-base font-bold text-slate-900">Dispatch Manifests (Linehaul)</h2>
            </div>

            {/* New Manifest Form */}
            <form
              onSubmit={handleCreateManifest}
              className="mb-5 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-12"
            >
              <input
                type="text"
                required
                value={manifestDest}
                onChange={(e) => setManifestDest(e.target.value)}
                placeholder="Destination Hub / City"
                className="sm:col-span-5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
              />
              <select
                value={manifestVehicleId}
                onChange={(e) => setManifestVehicleId(e.target.value)}
                className="sm:col-span-4 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="">Any Vehicle / Van</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.regNo} ({v.type})
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="sm:col-span-3 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
              >
                + Open Manifest
              </button>
            </form>

            {/* List Manifests */}
            {manifests.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-500">No manifests created yet.</p>
            ) : (
              <div className="space-y-4">
                {manifests.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg border p-4 ${
                      m.status === 'OPEN'
                        ? 'border-indigo-200 bg-indigo-50/30'
                        : 'border-slate-200 bg-slate-50/50'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-slate-900">{m.code}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              m.status === 'OPEN'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {m.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600">
                          {m.originHubName} &rarr; <strong>{m.destinationLabel}</strong>
                          {m.vehicle ? ` • Vehicle: ${m.vehicle.regNo}` : ''}
                        </p>
                      </div>

                      {m.status === 'OPEN' && (
                        <button
                          onClick={() => handleCloseManifest(m.id)}
                          disabled={m.items.length === 0}
                          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <Send className="h-3.5 w-3.5" />
                          Close &amp; Dispatch ({m.items.length})
                        </button>
                      )}
                    </div>

                    {/* Items inside manifest */}
                    {m.items.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {m.items.map((item) => (
                          <span
                            key={item.shipmentId}
                            className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                          >
                            <span className="font-mono font-semibold text-slate-800">
                              {item.shipment?.awb || item.shipmentId.slice(0, 8)}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              ({item.shipment?.status})
                            </span>
                            {m.status === 'OPEN' && (
                              <button
                                onClick={() => handleRemoveManifestItem(m.id, item.shipmentId)}
                                className="text-rose-500 hover:text-rose-700"
                                title="Remove from manifest"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Manual scan/add into OPEN manifest */}
                    {m.status === 'OPEN' && (
                      <div className="mt-3 flex gap-2">
                        <input
                          type="text"
                          placeholder="Add AWB or barcode to manifest..."
                          value={addItemInputs[m.id] || ''}
                          onChange={(e) =>
                            setAddItemInputs((p) => ({ ...p, [m.id]: e.target.value }))
                          }
                          className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-mono text-xs uppercase"
                        />
                        <button
                          onClick={() => handleAddManifestItem(m.id, addItemInputs[m.id] || '')}
                          className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                        >
                          Add Parcel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right 5 cols: Recent Scans Log */}
        <div className="lg:col-span-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-base font-bold text-slate-900">Recent Hub Gate Scans</h2>
            {recentScans.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">No gate scans recorded yet at this hub.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentScans.map((s) => (
                  <div key={s.id} className="flex items-start justify-between py-2.5 text-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 font-bold ${
                            s.direction === 'IN'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {s.direction}
                        </span>
                        <Link
                          href={`/track?awb=${s.awb}`}
                          className="font-mono font-semibold text-indigo-600 hover:underline"
                        >
                          {s.awb}
                        </Link>
                      </div>
                      {s.conditionNote && (
                        <p className="mt-0.5 text-slate-500">{s.conditionNote}</p>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {new Date(s.scannedAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
      ) : (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-5 text-xs text-slate-700">
          Hub floor inventory, ageing reports, and dispatch manifests are restricted to Hub Managers &amp; Operations Staff. Use the scanner above to record package IN/OUT gate events.
        </div>
      )}
    </div>
  );
}

