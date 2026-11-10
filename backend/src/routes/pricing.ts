import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { getRoutingOptions, currentStrategy } from '../lib/carriers/carrier-router';
import { getPricingConfig } from '../lib/pricing';
import { ok, handler, ApiError } from '../lib/errors';
import { requireAuth, optionalAuth, requireRole } from '../lib/auth';

export const pricingRouter = Router();

export const SERVICE_TYPE_VALUES = [
  'LOCAL',
  'INTERCITY',
  'EXPRESS',
  'EXPRESS_PREMIUM',
  'AIRMAX',
  'LTL_FREIGHT',
  'FTL_FREIGHT',
  'INTERNATIONAL',
  'HYPERLOCAL',
  'SCHEDULED',
  'RETURN',
] as const;

export const PACKAGING_VALUES = [
  'CUSTOMER_PACKED',
  'COMPANY_PACKED',
  'COMPANY_PACKED_FRAGILE',
  'TEMPERATURE_CONTROLLED',
] as const;

const quoteSchema = z.object({
  fromPincode: z.string().min(4),
  toPincode: z.string().min(3),
  serviceType: z.enum(SERVICE_TYPE_VALUES),
  packaging: z.enum(PACKAGING_VALUES).optional(),
  dims: z.object({
    lengthCm: z.number().positive(),
    widthCm: z.number().positive(),
    heightCm: z.number().positive(),
    actualWeightKg: z.number().positive(),
  }),
  declaredValue: z.number().optional(),
  protectionOpted: z.boolean().optional(),
  paymentMethod: z.enum(['PREPAID', 'COD', 'CORPORATE_CREDIT']).optional(),
  promoCode: z.string().optional(),
  destinationCountry: z.string().max(4).optional(),
  fulfillmentMode: z.enum(['OWN', 'PARTNER', 'AUTO']).optional(),
  ownOnly: z.boolean().optional(),
});

/** Look up active B2B contract rate multiplier for the caller if linked to an approved business account. */
export async function resolveCallerContractRule(userId?: string): Promise<Record<string, unknown> | undefined> {
  if (!userId) return undefined;
  const cust = await prisma.customer.findFirst({
    where: { userId },
    include: {
      businessAccount: {
        include: {
          contracts: {
            where: { validFrom: { lte: new Date() }, OR: [{ validTo: null }, { validTo: { gte: new Date() } }] },
            orderBy: { validFrom: 'desc' },
            take: 1,
          },
        },
      },
    },
  });
  if (!cust?.businessAccount?.isApproved) return undefined;
  const contract = cust.businessAccount.contracts[0];
  return contract ? (contract.ruleJson as Record<string, unknown>) : undefined;
}

/** POST /api/pricing/quote -> routing options (OWN and/or enabled Partners). */
pricingRouter.post(
  '/quote',
  optionalAuth,
  handler(async (req, res) => {
    const b = quoteSchema.parse(req.body);
    const contractRule = await resolveCallerContractRule(req.auth?.userId);
    const options = await getRoutingOptions({
      ...b,
      businessContractRule: contractRule,
    });
    const strategy = await currentStrategy();
    res.json(ok({ options, strategy, hasCorporateRate: Boolean(contractRule) }));
  }),
);

/** GET /api/pricing/strategy — current global routing mode. */
pricingRouter.get(
  '/strategy',
  requireAuth,
  handler(async (_req, res) => {
    const strategy = await currentStrategy();
    res.json(ok({ strategy }));
  }),
);

// ---------------------------------------------------------------------------
// Admin Pricing CRUD (Phase 4)
// ---------------------------------------------------------------------------

const PRICING_ADMIN_ROLES = ['SUPER_ADMIN', 'CITY_MANAGER', 'OPS_MANAGER'] as const;

/** GET /api/pricing/admin/rules — list all pricing rules + config defaults */
pricingRouter.get(
  '/admin/rules',
  requireAuth,
  requireRole(...PRICING_ADMIN_ROLES),
  handler(async (_req, res) => {
    const [rules, config] = await Promise.all([
      prisma.pricingRule.findMany({
        orderBy: [{ serviceType: 'asc' }, { originZone: 'asc' }, { destZone: 'asc' }, { maxWeightKg: 'asc' }],
      }),
      getPricingConfig(),
    ]);
    res.json(
      ok({
        rules: rules.map((r) => ({
          ...r,
          maxWeightKg: Number(r.maxWeightKg),
          price: Number(r.price),
        })),
        config,
      }),
    );
  }),
);

const ruleCreateSchema = z.object({
  id: z.string().optional(),
  serviceType: z.enum(SERVICE_TYPE_VALUES),
  originZone: z.string().min(2).transform((s) => s.trim().toUpperCase()),
  destZone: z.string().min(2).transform((s) => s.trim().toUpperCase()),
  maxWeightKg: z.number().positive(),
  price: z.number().nonnegative(),
  etaDays: z.number().int().positive(),
  isActive: z.boolean().default(true),
});

/** POST /api/pricing/admin/rules — create a new slab pricing rule */
pricingRouter.post(
  '/admin/rules',
  requireAuth,
  requireRole(...PRICING_ADMIN_ROLES),
  handler(async (req, res) => {
    const b = ruleCreateSchema.parse(req.body);
    const id =
      b.id ||
      `rule_${b.originZone}_${b.destZone}_${b.serviceType}_${b.maxWeightKg}`.replace(/[^A-Za-z0-9_]/g, '_');

    const rule = await prisma.pricingRule.upsert({
      where: { id },
      update: {
        serviceType: b.serviceType,
        originZone: b.originZone,
        destZone: b.destZone,
        maxWeightKg: String(b.maxWeightKg),
        price: String(b.price),
        etaDays: b.etaDays,
        isActive: b.isActive,
      },
      create: {
        id,
        serviceType: b.serviceType,
        originZone: b.originZone,
        destZone: b.destZone,
        maxWeightKg: String(b.maxWeightKg),
        price: String(b.price),
        etaDays: b.etaDays,
        isActive: b.isActive,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'pricing.rule_upsert',
        entity: 'PricingRule',
        entityId: rule.id,
        after: { originZone: b.originZone, destZone: b.destZone, serviceType: b.serviceType, price: b.price },
      },
    });

    res.status(201).json(ok({ ...rule, maxWeightKg: Number(rule.maxWeightKg), price: Number(rule.price) }));
  }),
);

const ruleUpdateSchema = z.object({
  maxWeightKg: z.number().positive().optional(),
  price: z.number().nonnegative().optional(),
  etaDays: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

/** PATCH /api/pricing/admin/rules/:id — update price/ETA/weight/active state */
pricingRouter.patch(
  '/admin/rules/:id',
  requireAuth,
  requireRole(...PRICING_ADMIN_ROLES),
  handler(async (req, res) => {
    const b = ruleUpdateSchema.parse(req.body);
    const existing = await prisma.pricingRule.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('PricingRule');

    const updated = await prisma.pricingRule.update({
      where: { id: existing.id },
      data: {
        ...(b.maxWeightKg !== undefined ? { maxWeightKg: String(b.maxWeightKg) } : {}),
        ...(b.price !== undefined ? { price: String(b.price) } : {}),
        ...(b.etaDays !== undefined ? { etaDays: b.etaDays } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'pricing.rule_update',
        entity: 'PricingRule',
        entityId: updated.id,
        after: b,
      },
    });

    res.json(ok({ ...updated, maxWeightKg: Number(updated.maxWeightKg), price: Number(updated.price) }));
  }),
);

/** DELETE /api/pricing/admin/rules/:id */
pricingRouter.delete(
  '/admin/rules/:id',
  requireAuth,
  requireRole(...PRICING_ADMIN_ROLES),
  handler(async (req, res) => {
    const existing = await prisma.pricingRule.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('PricingRule');
    await prisma.pricingRule.delete({ where: { id: existing.id } });
    res.json(ok({ deleted: existing.id }));
  }),
);

const configUpdateSchema = z.object({
  volumetricDivisor: z.number().positive().optional(),
  weightStepKg: z.number().positive().optional(),
  taxRate: z.number().min(0).max(1).optional(),
  protectionRate: z.number().min(0).max(0.5).optional(),
  pickupFee: z.number().min(0).optional(),
  packagingFee: z.number().min(0).optional(),
  fragilePackagingFee: z.number().min(0).optional(),
  tempPackagingFee: z.number().min(0).optional(),
  codFee: z.number().min(0).optional(),
  codMaxAmount: z.number().min(0).optional(),
  serviceSurcharge: z.number().min(0).optional(),
});

/** PATCH /api/pricing/admin/config — update fees, volumetric divisor, tax, surcharges */
pricingRouter.patch(
  '/admin/config',
  requireAuth,
  requireRole(...PRICING_ADMIN_ROLES),
  handler(async (req, res) => {
    const b = configUpdateSchema.parse(req.body);
    const entries = Object.entries(b).filter(([, v]) => v !== undefined);
    for (const [key, val] of entries) {
      await prisma.pricingConfig.upsert({
        where: { key },
        update: { value: String(val) },
        create: { key, value: String(val) },
      });
    }
    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'pricing.config_update',
        entity: 'PricingConfig',
        entityId: 'GLOBAL',
        after: b,
      },
    });
    res.json(ok(await getPricingConfig()));
  }),
);

/** POST /api/pricing/admin/rules/bulk — CSV/JSON bulk pricing slab import */
pricingRouter.post(
  '/admin/rules/bulk',
  requireAuth,
  requireRole(...PRICING_ADMIN_ROLES),
  handler(async (req, res) => {
    const { rows } = z
      .object({
        rows: z.array(ruleCreateSchema).min(1).max(200),
      })
      .parse(req.body);

    let imported = 0;
    for (const b of rows) {
      const id =
        b.id ||
        `rule_${b.originZone}_${b.destZone}_${b.serviceType}_${b.maxWeightKg}`.replace(/[^A-Za-z0-9_]/g, '_');
      await prisma.pricingRule.upsert({
        where: { id },
        update: {
          serviceType: b.serviceType,
          originZone: b.originZone,
          destZone: b.destZone,
          maxWeightKg: String(b.maxWeightKg),
          price: String(b.price),
          etaDays: b.etaDays,
          isActive: b.isActive,
        },
        create: {
          id,
          serviceType: b.serviceType,
          originZone: b.originZone,
          destZone: b.destZone,
          maxWeightKg: String(b.maxWeightKg),
          price: String(b.price),
          etaDays: b.etaDays,
          isActive: b.isActive,
        },
      });
      imported += 1;
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'pricing.rules_bulk',
        entity: 'PricingRule',
        entityId: 'BULK',
        after: { imported },
      },
    });
    res.status(201).json(ok({ imported }));
  }),
);
