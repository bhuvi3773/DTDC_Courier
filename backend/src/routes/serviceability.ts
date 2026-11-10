import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ok, handler, ApiError } from '../lib/errors';
import { requireAuth, requireRole } from '../lib/auth';

export const serviceabilityRouter = Router();

export const INTERNATIONAL_DESTINATIONS = [
  { code: 'US', name: 'United States', transitDays: 5, startingPriceInr: 1490 },
  { code: 'GB', name: 'United Kingdom', transitDays: 4, startingPriceInr: 1390 },
  { code: 'AE', name: 'United Arab Emirates', transitDays: 3, startingPriceInr: 1090 },
  { code: 'SG', name: 'Singapore', transitDays: 3, startingPriceInr: 1120 },
  { code: 'DE', name: 'Germany & EU (27 Nations)', transitDays: 5, startingPriceInr: 1450 },
  { code: 'CA', name: 'Canada', transitDays: 5, startingPriceInr: 1520 },
  { code: 'AU', name: 'Australia', transitDays: 6, startingPriceInr: 1620 },
];

/** GET /api/serviceability/check?from=<pincode>&to=<pincode>&country=IN */
serviceabilityRouter.get(
  '/check',
  handler(async (req, res) => {
    const from = String(req.query.from ?? '').trim();
    const to = String(req.query.to ?? '').trim();
    const country = String(req.query.country ?? 'IN').trim().toUpperCase();
    if (!from || (!to && country === 'IN')) {
      throw ApiError.badRequest('MISSING_PARAMS', 'from and to pincode are required');
    }

    if (country !== 'IN') {
      const fromP = await prisma.pincode.findUnique({ where: { pincode: from }, include: { city: true } });
      const own = Boolean(fromP?.ownPickup && fromP.city.status === 'ACTIVE');
      const partner = Boolean(fromP?.partnerServiceable ?? true);
      const destMeta = INTERNATIONAL_DESTINATIONS.find((d) => d.code === country) ?? {
        code: country,
        name: country,
        transitDays: 6,
        startingPriceInr: 1690,
      };
      return res.json(
        ok({
          serviceable: own || partner,
          own,
          partner,
          international: true,
          from: fromP ? { city: fromP.city.name, zone: fromP.zone } : null,
          to: { city: destMeta.name, zone: `INTL-${destMeta.code}` },
          estimatedDays: destMeta.transitDays,
        }),
      );
    }

    const rows = await prisma.pincode.findMany({ where: { pincode: { in: [from, to] } }, include: { city: true } });
    const fromP = rows.find((r) => r.pincode === from);
    const toP = rows.find((r) => r.pincode === to);
    const own = !!(fromP?.ownPickup && toP?.ownDelivery && fromP?.city.status === 'ACTIVE' && toP?.city.status === 'ACTIVE');
    const partner = !!(fromP?.partnerServiceable && toP?.partnerServiceable);
    res.json(
      ok({
        serviceable: own || partner,
        own,
        partner,
        international: false,
        from: fromP ? { city: fromP.city.name, zone: fromP.zone } : null,
        to: toP ? { city: toP.city.name, zone: toP.zone } : null,
      }),
    );
  }),
);

/** GET /api/serviceability/network — public coverage summary for quick calculator & service pages */
serviceabilityRouter.get(
  '/network',
  handler(async (_req, res) => {
    const [cities, pincodes, hubs, carriers] = await Promise.all([
      prisma.city.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, state: true },
        orderBy: { name: 'asc' },
      }),
      prisma.pincode.findMany({
        include: { city: { select: { name: true, state: true, status: true } } },
        orderBy: { pincode: 'asc' },
        take: 100,
      }),
      prisma.hub.findMany({
        include: { city: { select: { name: true, state: true } } },
      }),
      prisma.carrier.findMany({
        where: { isEnabled: true },
        select: { code: true, name: true, type: true, settings: true },
      }),
    ]);

    res.json(
      ok({
        activeCities: cities,
        samplePincodes: pincodes,
        hubs,
        carriers,
        internationalDestinations: INTERNATIONAL_DESTINATIONS,
      }),
    );
  }),
);

// ---------------------------------------------------------------------------
// Admin Serviceability CRUD & City Activation Validation (Phase 4 / U4)
// ---------------------------------------------------------------------------

const ADMIN_SERVICEABILITY_ROLES = ['SUPER_ADMIN', 'CITY_MANAGER', 'OPS_MANAGER'] as const;

async function checkCityPrerequisites(cityId: string) {
  const [hubCount, pincodes] = await Promise.all([
    prisma.hub.count({ where: { cityId } }),
    prisma.pincode.findMany({ where: { cityId } }),
  ]);

  const ownPincodes = pincodes.filter((p) => p.ownPickup && p.ownDelivery);
  const zones = Array.from(new Set(pincodes.map((p) => p.zone)));
  const pricingRulesCount =
    zones.length > 0
      ? await prisma.pricingRule.count({
          where: {
            isActive: true,
            OR: [{ originZone: { in: zones } }, { destZone: { in: zones } }],
          },
        })
      : 0;

  const missing: string[] = [];
  if (hubCount === 0) missing.push('At least 1 sorting hub must be registered for this city');
  if (ownPincodes.length === 0)
    missing.push('At least 1 pincode with both ownPickup and ownDelivery enabled is required');
  if (pricingRulesCount === 0)
    missing.push('At least 1 active PricingRule covering this city zone must exist');

  return { missing, hubCount, ownPincodeCount: ownPincodes.length, pricingRulesCount };
}

/** GET /api/serviceability/admin/cities — all cities, hubs, pincodes, readiness */
serviceabilityRouter.get(
  '/admin/cities',
  requireAuth,
  requireRole(...ADMIN_SERVICEABILITY_ROLES),
  handler(async (_req, res) => {
    const cities = await prisma.city.findMany({
      include: {
        hubs: { select: { id: true, name: true, address: true } },
        pincodes: { orderBy: { pincode: 'asc' } },
      },
      orderBy: { name: 'asc' },
    });

    const enriched = await Promise.all(
      cities.map(async (c) => ({
        ...c,
        prerequisites: await checkCityPrerequisites(c.id),
      })),
    );
    res.json(ok(enriched));
  }),
);

/** POST /api/serviceability/admin/cities — create a new city (starts INACTIVE) */
const createCitySchema = z.object({
  name: z.string().min(2),
  state: z.string().min(2),
});

serviceabilityRouter.post(
  '/admin/cities',
  requireAuth,
  requireRole(...ADMIN_SERVICEABILITY_ROLES),
  handler(async (req, res) => {
    const b = createCitySchema.parse(req.body);
    const existing = await prisma.city.findUnique({ where: { name: b.name.trim() } });
    if (existing) throw ApiError.badRequest('CITY_EXISTS', `City "${b.name}" already exists`);
    const city = await prisma.city.create({
      data: { name: b.name.trim(), state: b.state.trim(), status: 'INACTIVE' },
    });
    res.status(201).json(ok(city));
  }),
);

/** POST /api/serviceability/admin/cities/:id/activate — validate prerequisites & activate */
serviceabilityRouter.post(
  '/admin/cities/:id/activate',
  requireAuth,
  requireRole(...ADMIN_SERVICEABILITY_ROLES),
  handler(async (req, res) => {
    const city = await prisma.city.findUnique({ where: { id: req.params.id } });
    if (!city) throw ApiError.notFound('City');

    const check = await checkCityPrerequisites(city.id);
    if (check.missing.length > 0) {
      throw ApiError.unprocessable(
        `Cannot activate ${city.name}: ${check.missing.join('; ')}`,
        'CITY_ACTIVATION_BLOCKED',
        { missing: check.missing },
      );
    }

    const updated = await prisma.city.update({
      where: { id: city.id },
      data: { status: 'ACTIVE' },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'city.activate',
        entity: 'City',
        entityId: city.id,
        after: { name: city.name, status: 'ACTIVE' },
      },
    });

    res.json(ok(updated));
  }),
);

/** PATCH /api/serviceability/admin/cities/:id/suspend — deactivate city */
serviceabilityRouter.patch(
  '/admin/cities/:id/suspend',
  requireAuth,
  requireRole(...ADMIN_SERVICEABILITY_ROLES),
  handler(async (req, res) => {
    const city = await prisma.city.findUnique({ where: { id: req.params.id } });
    if (!city) throw ApiError.notFound('City');
    const updated = await prisma.city.update({
      where: { id: city.id },
      data: { status: 'INACTIVE' },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'city.suspend',
        entity: 'City',
        entityId: city.id,
        after: { name: city.name, status: 'INACTIVE' },
      },
    });
    res.json(ok(updated));
  }),
);

/** POST /api/serviceability/admin/pincodes — create or update pincode serviceability */
const upsertPincodeSchema = z.object({
  pincode: z.string().regex(/^\d{5,6}$/, 'Pincode must be 5 or 6 digits'),
  cityId: z.string(),
  zone: z.string().min(2).transform((s) => s.trim().toUpperCase()),
  ownPickup: z.boolean().default(false),
  ownDelivery: z.boolean().default(false),
  partnerServiceable: z.boolean().default(true),
});

serviceabilityRouter.post(
  '/admin/pincodes',
  requireAuth,
  requireRole(...ADMIN_SERVICEABILITY_ROLES),
  handler(async (req, res) => {
    const b = upsertPincodeSchema.parse(req.body);
    const city = await prisma.city.findUnique({ where: { id: b.cityId } });
    if (!city) throw ApiError.notFound('City');

    const row = await prisma.pincode.upsert({
      where: { pincode: b.pincode },
      update: {
        cityId: b.cityId,
        zone: b.zone,
        ownPickup: b.ownPickup,
        ownDelivery: b.ownDelivery,
        partnerServiceable: b.partnerServiceable,
      },
      create: b,
    });
    res.status(201).json(ok(row));
  }),
);

/** POST /api/serviceability/admin/pincodes/bulk — CSV/JSON bulk pincode import */
serviceabilityRouter.post(
  '/admin/pincodes/bulk',
  requireAuth,
  requireRole(...ADMIN_SERVICEABILITY_ROLES),
  handler(async (req, res) => {
    const { rows } = z
      .object({
        rows: z.array(upsertPincodeSchema).min(1).max(200),
      })
      .parse(req.body);

    const cityIds = Array.from(new Set(rows.map((r) => r.cityId)));
    const foundCities = await prisma.city.findMany({ where: { id: { in: cityIds } }, select: { id: true } });
    const validCitySet = new Set(foundCities.map((c) => c.id));

    let imported = 0;
    const errors: Array<{ pincode: string; reason: string }> = [];
    for (const r of rows) {
      if (!validCitySet.has(r.cityId)) {
        errors.push({ pincode: r.pincode, reason: `Unknown cityId ${r.cityId}` });
        continue;
      }
      await prisma.pincode.upsert({
        where: { pincode: r.pincode },
        update: {
          cityId: r.cityId,
          zone: r.zone,
          ownPickup: r.ownPickup,
          ownDelivery: r.ownDelivery,
          partnerServiceable: r.partnerServiceable,
        },
        create: r,
      });
      imported += 1;
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'serviceability.bulk_pincodes',
        entity: 'Pincode',
        entityId: 'BULK',
        after: { imported, errorCount: errors.length },
      },
    });

    res.status(201).json(ok({ imported, failed: errors.length, errors }));
  }),
);
