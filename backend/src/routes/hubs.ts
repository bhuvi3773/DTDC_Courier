import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { ShipmentStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ok, handler, ApiError } from '../lib/errors';
import { requireAuth, requireRole } from '../lib/auth';
import { ALLOWED_TRANSITIONS, recordEvent } from '../lib/tracking';
import { resolveShipment } from '../lib/operations';

export const hubsRouter = Router();
export const manifestsRouter = Router();

const HUB_ROLES = ['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'HUB_MANAGER', 'SUPERVISOR'] as const;

// ---------------------------------------------------------------------------
// Hubs & Vehicles
// ---------------------------------------------------------------------------

// GET /api/hubs — list hubs, vehicles, and cities
hubsRouter.get(
  '/',
  requireAuth,
  requireRole(...HUB_ROLES, 'AGENT'),
  handler(async (_req, res) => {
    const [hubs, vehicles, cities] = await Promise.all([
      prisma.hub.findMany({
        include: { city: true, _count: { select: { scans: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.vehicle.findMany({ orderBy: { regNo: 'asc' } }),
      prisma.city.findMany({ orderBy: { name: 'asc' } }),
    ]);
    res.json(
      ok({
        hubs: hubs.map((h) => ({
          id: h.id,
          name: h.name,
          address: h.address,
          cityId: h.cityId,
          cityName: h.city.name,
          scanCount: h._count.scans,
        })),
        vehicles,
        cities,
      }),
    );
  }),
);

// POST /api/hubs — register a new hub
const createHubSchema = z.object({
  name: z.string().min(2),
  cityId: z.string(),
  address: z.string().min(3),
});

hubsRouter.post(
  '/',
  requireAuth,
  requireRole('SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER'),
  handler(async (req, res) => {
    const b = createHubSchema.parse(req.body);
    const city = await prisma.city.findUnique({ where: { id: b.cityId } });
    if (!city) throw ApiError.notFound('City');
    const hub = await prisma.hub.create({
      data: { name: b.name, cityId: b.cityId, address: b.address },
      include: { city: true },
    });
    res.status(201).json(ok({ ...hub, cityName: hub.city.name }));
  }),
);

// POST /api/hubs/vehicles — register a vehicle
const createVehicleSchema = z.object({
  regNo: z.string().min(4),
  type: z.string().min(2),
  capacityKg: z.number().int().positive(),
  cityId: z.string(),
});

hubsRouter.post(
  '/vehicles',
  requireAuth,
  requireRole('SUPER_ADMIN', 'OPS_MANAGER', 'HUB_MANAGER'),
  handler(async (req, res) => {
    const b = createVehicleSchema.parse(req.body);
    const vehicle = await prisma.vehicle.create({
      data: {
        id: crypto.randomUUID(),
        regNo: b.regNo.toUpperCase(),
        type: b.type,
        capacityKg: b.capacityKg,
        cityId: b.cityId,
      },
    });
    res.status(201).json(ok(vehicle));
  }),
);

// GET /api/hubs/:id/inventory — parcels currently checked IN at this hub + scan history
hubsRouter.get(
  '/:id/inventory',
  requireAuth,
  requireRole(...HUB_ROLES),
  handler(async (req, res) => {
    const hub = await prisma.hub.findUnique({ where: { id: req.params.id }, include: { city: true } });
    if (!hub) throw ApiError.notFound('Hub');

    const scans = await prisma.hubScan.findMany({
      where: { hubId: hub.id },
      orderBy: { scannedAt: 'desc' },
      take: 250,
    });

    // Latest scan per shipment at this hub: if latest is IN, parcel is currently at hub.
    const latestScanByShip = new Map<string, typeof scans[number]>();
    for (const s of scans) {
      if (!latestScanByShip.has(s.shipmentId)) {
        latestScanByShip.set(s.shipmentId, s);
      }
    }

    const activeShipmentIds = Array.from(latestScanByShip.values())
      .filter((s) => s.direction === 'IN')
      .map((s) => s.shipmentId);

    const activeShipments =
      activeShipmentIds.length > 0
        ? await prisma.shipment.findMany({
            where: {
              id: { in: activeShipmentIds },
              status: { in: ['AT_ORIGIN_HUB', 'AT_DESTINATION_HUB', 'PICKED_UP', 'RTO_IN_TRANSIT'] },
            },
            include: { packages: true },
          })
        : [];

    const nowMs = Date.now();
    const inventory = activeShipments.map((s) => {
      const scan = latestScanByShip.get(s.id)!;
      const ageingHours = Math.round(((nowMs - scan.scannedAt.getTime()) / 3600_000) * 10) / 10;
      return {
        shipmentId: s.id,
        awb: s.awb,
        status: s.status,
        serviceType: s.serviceType,
        bookCount: s.bookCount,
        parcelCount: s.parcelCount,
        scannedAt: scan.scannedAt,
        conditionNote: scan.conditionNote,
        ageingHours,
      };
    });

    // Enrich recent scans with AWB
    const scanShipIds = Array.from(new Set(scans.slice(0, 40).map((s) => s.shipmentId)));
    const scanShips = scanShipIds.length
      ? await prisma.shipment.findMany({ where: { id: { in: scanShipIds } }, select: { id: true, awb: true, status: true } })
      : [];
    const awbMap = new Map(scanShips.map((s) => [s.id, s]));

    res.json(
      ok({
        hub: { id: hub.id, name: hub.name, cityName: hub.city.name, address: hub.address },
        inventory,
        recentScans: scans.slice(0, 40).map((s) => ({
          ...s,
          awb: awbMap.get(s.shipmentId)?.awb ?? s.shipmentId,
          shipmentStatus: awbMap.get(s.shipmentId)?.status ?? null,
        })),
      }),
    );
  }),
);

// POST /api/hubs/:id/scan-in — record HubScan IN and advance status (AT_ORIGIN_HUB or AT_DESTINATION_HUB)
const hubScanSchema = z.object({
  code: z.string().min(3),
  conditionNote: z.string().optional(),
  hubRole: z.enum(['ORIGIN', 'DESTINATION']).optional(),
});

hubsRouter.post(
  '/:id/scan-in',
  requireAuth,
  requireRole(...HUB_ROLES, 'AGENT'),
  handler(async (req, res) => {
    const b = hubScanSchema.parse(req.body);
    const hub = await prisma.hub.findUnique({ where: { id: req.params.id } });
    if (!hub) throw ApiError.notFound('Hub');

    const shipment = await resolveShipment(b.code);
    const activeLeg = shipment.legs[shipment.legs.length - 1];
    if (activeLeg?.carrierType === 'PARTNER') {
      throw ApiError.forbidden('Partner-carried shipment status cannot be changed by internal hub scans', 'PARTNER_LEG_NO_STATUS');
    }

    let targetStatus: ShipmentStatus | null = null;
    if (b.hubRole === 'ORIGIN') {
      targetStatus = 'AT_ORIGIN_HUB';
    } else if (b.hubRole === 'DESTINATION') {
      targetStatus = 'AT_DESTINATION_HUB';
    } else {
      if (shipment.status === 'PICKED_UP') targetStatus = 'AT_ORIGIN_HUB';
      else if (shipment.status === 'IN_TRANSIT') targetStatus = 'AT_DESTINATION_HUB';
      else if (shipment.status === 'RTO_INITIATED') targetStatus = 'RTO_IN_TRANSIT';
    }

    let statusChanged = false;
    let finalStatus = shipment.status;

    if (targetStatus && targetStatus !== shipment.status) {
      if (!ALLOWED_TRANSITIONS[shipment.status]?.includes(targetStatus)) {
        throw ApiError.unprocessable(
          `Cannot scan into hub (${targetStatus}) when shipment status is ${shipment.status}`,
          'INVALID_TRANSITION',
        );
      }
      const ev = await recordEvent({
        shipmentId: shipment.id,
        legId: activeLeg?.id,
        kind: 'STATUS',
        status: targetStatus,
        source: 'ADMIN',
        actorUserId: req.auth.userId,
        locationLabel: hub.name,
        remarks: b.conditionNote ? `Scanned in at ${hub.name}: ${b.conditionNote}` : `Scanned in at ${hub.name}`,
        eventTime: new Date(),
      });
      statusChanged = ev.applied;
      finalStatus = ev.shipmentStatus;
    }

    const scan = await prisma.hubScan.create({
      data: {
        hubId: hub.id,
        shipmentId: shipment.id,
        direction: 'IN',
        scannedBy: req.auth.userId,
        conditionNote: b.conditionNote ?? null,
      },
    });

    res.status(201).json(
      ok({
        scan,
        awb: shipment.awb,
        shipmentId: shipment.id,
        shipmentStatus: finalStatus,
        statusChanged,
      }),
    );
  }),
);

// POST /api/hubs/:id/scan-out — record HubScan OUT
hubsRouter.post(
  '/:id/scan-out',
  requireAuth,
  requireRole(...HUB_ROLES, 'AGENT'),
  handler(async (req, res) => {
    const b = hubScanSchema.parse(req.body);
    const hub = await prisma.hub.findUnique({ where: { id: req.params.id } });
    if (!hub) throw ApiError.notFound('Hub');

    const shipment = await resolveShipment(b.code);
    const scan = await prisma.hubScan.create({
      data: {
        hubId: hub.id,
        shipmentId: shipment.id,
        direction: 'OUT',
        scannedBy: req.auth.userId,
        conditionNote: b.conditionNote ?? null,
      },
    });

    res.status(201).json(
      ok({
        scan,
        awb: shipment.awb,
        shipmentId: shipment.id,
        shipmentStatus: shipment.status,
      }),
    );
  }),
);

// ---------------------------------------------------------------------------
// Vehicle Manifests (/api/manifests)
// ---------------------------------------------------------------------------

// GET /api/manifests — list manifests with hydrated hubs, vehicles, and items
manifestsRouter.get(
  '/',
  requireAuth,
  requireRole(...HUB_ROLES),
  handler(async (_req, res) => {
    const [manifests, hubs, vehicles] = await Promise.all([
      prisma.manifest.findMany({
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.hub.findMany(),
      prisma.vehicle.findMany(),
    ]);

    const hubMap = new Map(hubs.map((h) => [h.id, h]));
    const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));

    const allShipIds = Array.from(new Set(manifests.flatMap((m) => m.items.map((i) => i.shipmentId))));
    const shipments = allShipIds.length
      ? await prisma.shipment.findMany({
          where: { id: { in: allShipIds } },
          select: { id: true, awb: true, status: true, serviceType: true, bookCount: true },
        })
      : [];
    const shipMap = new Map(shipments.map((s) => [s.id, s]));

    res.json(
      ok(
        manifests.map((m) => ({
          ...m,
          originHubName: hubMap.get(m.originHubId)?.name ?? m.originHubId,
          vehicle: m.vehicleId ? vehicleMap.get(m.vehicleId) ?? null : null,
          items: m.items.map((i) => ({
            shipmentId: i.shipmentId,
            shipment: shipMap.get(i.shipmentId) ?? null,
          })),
        })),
      ),
    );
  }),
);

// POST /api/manifests — create a new OPEN manifest
const createManifestSchema = z.object({
  originHubId: z.string(),
  destinationLabel: z.string().min(2),
  vehicleId: z.string().optional(),
  carrierId: z.string().optional(),
});

manifestsRouter.post(
  '/',
  requireAuth,
  requireRole(...HUB_ROLES),
  handler(async (req, res) => {
    const b = createManifestSchema.parse(req.body);
    const hub = await prisma.hub.findUnique({ where: { id: b.originHubId } });
    if (!hub) throw ApiError.notFound('Origin Hub');

    if (b.vehicleId) {
      const v = await prisma.vehicle.findUnique({ where: { id: b.vehicleId } });
      if (!v) throw ApiError.notFound('Vehicle');
    }

    const ym = new Date().toISOString().slice(2, 7).replace('-', '');
    const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const code = `MNF-${ym}-${suffix}`;

    const manifest = await prisma.manifest.create({
      data: {
        code,
        originHubId: b.originHubId,
        destinationLabel: b.destinationLabel,
        vehicleId: b.vehicleId ?? null,
        carrierId: b.carrierId ?? null,
        status: 'OPEN',
      },
      include: { items: true },
    });

    res.status(201).json(ok(manifest));
  }),
);

// POST /api/manifests/:id/items — attach shipments (AWB, barcode, or UUID) to an OPEN manifest
const addItemsSchema = z.object({
  codes: z.array(z.string().min(1)).min(1),
});

manifestsRouter.post(
  '/:id/items',
  requireAuth,
  requireRole(...HUB_ROLES),
  handler(async (req, res) => {
    const b = addItemsSchema.parse(req.body);
    const manifest = await prisma.manifest.findUnique({ where: { id: req.params.id } });
    if (!manifest) throw ApiError.notFound('Manifest');
    if (manifest.status !== 'OPEN') {
      throw ApiError.unprocessable('Cannot modify a closed manifest', 'MANIFEST_CLOSED');
    }

    const added: string[] = [];
    for (const rawCode of b.codes) {
      const shipment = await resolveShipment(rawCode);
      const activeLeg = shipment.legs[shipment.legs.length - 1];
      if (activeLeg?.carrierType === 'PARTNER') {
        throw ApiError.forbidden(`Shipment ${shipment.awb} uses a PARTNER leg`, 'PARTNER_LEG_NO_STATUS');
      }
      if (!['PICKED_UP', 'AT_ORIGIN_HUB', 'AT_DESTINATION_HUB', 'RTO_INITIATED'].includes(shipment.status)) {
        throw ApiError.unprocessable(
          `Shipment ${shipment.awb} is in status ${shipment.status} and cannot be manifested for linehaul`,
          'INVALID_STATUS_FOR_MANIFEST',
        );
      }

      await prisma.manifestItem.upsert({
        where: { manifestId_shipmentId: { manifestId: manifest.id, shipmentId: shipment.id } },
        update: {},
        create: { manifestId: manifest.id, shipmentId: shipment.id },
      });
      added.push(shipment.awb);
    }

    res.json(ok({ manifestId: manifest.id, added }));
  }),
);

// DELETE /api/manifests/:id/items/:shipmentId — remove parcel from OPEN manifest
manifestsRouter.delete(
  '/:id/items/:shipmentId',
  requireAuth,
  requireRole(...HUB_ROLES),
  handler(async (req, res) => {
    const manifest = await prisma.manifest.findUnique({ where: { id: req.params.id } });
    if (!manifest) throw ApiError.notFound('Manifest');
    if (manifest.status !== 'OPEN') {
      throw ApiError.unprocessable('Cannot modify a closed manifest', 'MANIFEST_CLOSED');
    }

    await prisma.manifestItem.deleteMany({
      where: { manifestId: manifest.id, shipmentId: req.params.shipmentId },
    });
    res.json(ok({ removed: req.params.shipmentId }));
  }),
);

// POST /api/manifests/:id/close — close manifest, scan out items, dispatch IN_TRANSIT
manifestsRouter.post(
  '/:id/close',
  requireAuth,
  requireRole(...HUB_ROLES),
  handler(async (req, res) => {
    const manifest = await prisma.manifest.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!manifest) throw ApiError.notFound('Manifest');
    if (manifest.status !== 'OPEN') {
      throw ApiError.unprocessable('Manifest is already closed', 'MANIFEST_ALREADY_CLOSED');
    }
    if (manifest.items.length === 0) {
      throw ApiError.badRequest('MANIFEST_EMPTY', 'Add at least one shipment before closing a manifest');
    }

    const originHub = await prisma.hub.findUnique({ where: { id: manifest.originHubId } });
    const dispatched: Array<{ shipmentId: string; awb: string; status: string }> = [];

    for (const item of manifest.items) {
      const shipment = await prisma.shipment.findUnique({
        where: { id: item.shipmentId },
        include: { legs: { orderBy: { sequence: 'desc' }, take: 1 } },
      });
      if (!shipment) continue;

      const targetStatus: ShipmentStatus =
        shipment.status === 'RTO_INITIATED' ? 'RTO_IN_TRANSIT' : 'IN_TRANSIT';

      if (ALLOWED_TRANSITIONS[shipment.status]?.includes(targetStatus)) {
        const ev = await recordEvent({
          shipmentId: shipment.id,
          legId: shipment.legs[0]?.id,
          kind: 'STATUS',
          status: targetStatus,
          source: 'ADMIN',
          actorUserId: req.auth.userId,
          locationLabel: originHub ? `${originHub.name} -> ${manifest.destinationLabel}` : manifest.destinationLabel,
          remarks: `Dispatched on manifest ${manifest.code}`,
          eventTime: new Date(),
        });
        dispatched.push({ shipmentId: shipment.id, awb: shipment.awb, status: ev.shipmentStatus });
      } else {
        dispatched.push({ shipmentId: shipment.id, awb: shipment.awb, status: shipment.status });
      }

      await prisma.hubScan.create({
        data: {
          hubId: manifest.originHubId,
          shipmentId: shipment.id,
          direction: 'OUT',
          scannedBy: req.auth.userId,
          conditionNote: `Dispatched on ${manifest.code} to ${manifest.destinationLabel}`,
        },
      });
    }

    const closed = await prisma.manifest.update({
      where: { id: manifest.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'manifest.close',
        entity: 'Manifest',
        entityId: manifest.id,
        after: { code: manifest.code, itemCount: dispatched.length },
      },
    });

    res.json(ok({ manifest: closed, dispatched }));
  }),
);

