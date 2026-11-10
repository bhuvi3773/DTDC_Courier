import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { validatePromoCode } from '../lib/promos';
import { ok, handler, ApiError } from '../lib/errors';
import { requireAuth, requireRole } from '../lib/auth';

export const promosRouter = Router();

/** GET /api/promos/active — public featured promo codes */
promosRouter.get(
  '/active',
  handler(async (_req, res) => {
    const promos = await prisma.promoCode.findMany({
      where: {
        isActive: true,
        OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    res.json(
      ok(
        promos.map((p) => ({
          id: p.id,
          code: p.code,
          description: p.description,
          discountType: p.discountType,
          discountValue: Number(p.discountValue),
          maxDiscount: p.maxDiscount != null ? Number(p.maxDiscount) : null,
          minOrderAmount: Number(p.minOrderAmount),
          validUntil: p.validUntil,
        })),
      ),
    );
  }),
);

/** POST /api/promos/validate — live coupon validation for booking widget */
promosRouter.post(
  '/validate',
  handler(async (req, res) => {
    const { code, subtotal } = z
      .object({
        code: z.string().min(2),
        subtotal: z.number().nonnegative().default(250),
      })
      .parse(req.body ?? {});

    const result = await validatePromoCode(code, subtotal);
    if (!result) throw ApiError.badRequest('INVALID_PROMO', 'Invalid promo code');
    res.json(ok(result));
  }),
);

// ---------- Admin Promo Management ----------
const PROMO_ADMIN_ROLES = ['SUPER_ADMIN', 'OPS_MANAGER', 'FINANCE'] as const;

promosRouter.get(
  '/admin',
  requireAuth,
  requireRole(...PROMO_ADMIN_ROLES),
  handler(async (_req, res) => {
    const promos = await prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(
      ok(
        promos.map((p) => ({
          ...p,
          discountValue: Number(p.discountValue),
          maxDiscount: p.maxDiscount != null ? Number(p.maxDiscount) : null,
          minOrderAmount: Number(p.minOrderAmount),
        })),
      ),
    );
  }),
);

const createPromoSchema = z.object({
  code: z.string().trim().min(3).max(24).transform((s) => s.toUpperCase().replace(/\s+/g, '')),
  description: z.string().trim().min(4),
  discountType: z.enum(['PERCENT', 'FLAT']).default('PERCENT'),
  discountValue: z.number().positive(),
  maxDiscount: z.number().positive().nullable().optional(),
  minOrderAmount: z.number().nonnegative().default(0),
  usageLimit: z.number().int().positive().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  isActive: z.boolean().default(true),
});

promosRouter.post(
  '/admin',
  requireAuth,
  requireRole(...PROMO_ADMIN_ROLES),
  handler(async (req, res) => {
    const b = createPromoSchema.parse(req.body);
    const created = await prisma.promoCode.upsert({
      where: { code: b.code },
      update: {
        description: b.description,
        discountType: b.discountType,
        discountValue: b.discountValue,
        maxDiscount: b.maxDiscount ?? null,
        minOrderAmount: b.minOrderAmount,
        usageLimit: b.usageLimit ?? null,
        validUntil: b.validUntil ? new Date(b.validUntil) : null,
        isActive: b.isActive,
      },
      create: {
        code: b.code,
        description: b.description,
        discountType: b.discountType,
        discountValue: b.discountValue,
        maxDiscount: b.maxDiscount ?? null,
        minOrderAmount: b.minOrderAmount,
        usageLimit: b.usageLimit ?? null,
        validUntil: b.validUntil ? new Date(b.validUntil) : null,
        isActive: b.isActive,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'promo.upsert',
        entity: 'PromoCode',
        entityId: created.id,
        after: { code: created.code, discountType: created.discountType, discountValue: Number(created.discountValue) },
      },
    });
    res.status(201).json(ok(created));
  }),
);

promosRouter.patch(
  '/admin/:id',
  requireAuth,
  requireRole(...PROMO_ADMIN_ROLES),
  handler(async (req, res) => {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
    const updated = await prisma.promoCode.update({
      where: { id: req.params.id },
      data: { isActive },
    });
    res.json(ok(updated));
  }),
);

