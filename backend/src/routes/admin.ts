import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { ok, handler, ApiError } from '../lib/errors';
import {
  requireAuth,
  requireRole,
  normalizeEmail,
  validatePasswordStrength,
  revokeAllRefreshTokens,
} from '../lib/auth';

export const adminRouter = Router();

// GET /api/admin/carriers — carrier list (credentials never returned).
adminRouter.get(
  '/carriers',
  requireAuth,
  requireRole('SUPER_ADMIN', 'OPS_MANAGER', 'HUB_MANAGER'),
  handler(async (_req, res) => {
    const carriers = await prisma.carrier.findMany({
      select: { id: true, code: true, name: true, type: true, isEnabled: true, settings: true },
    });
    res.json(ok(carriers));
  }),
);

// PATCH /api/admin/carriers/:id/toggle — per-carrier enable/disable switch.
adminRouter.patch(
  '/carriers/:id/toggle',
  requireAuth,
  requireRole('SUPER_ADMIN', 'OPS_MANAGER'),
  handler(async (req, res) => {
    const { isEnabled } = req.body as { isEnabled: boolean };
    const c = await prisma.carrier.update({ where: { id: req.params.id }, data: { isEnabled } });
    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'carrier.toggle',
        entity: 'Carrier',
        entityId: c.id,
        after: { isEnabled },
      },
    });
    res.json(ok({ id: c.id, code: c.code, isEnabled }));
  }),
);

// PATCH /api/admin/settings/routing-strategy — global routing mode switch (U7).
const strategySchema = z.object({ strategy: z.enum(['OWN_ONLY', 'PARTNER_ONLY', 'AUTO_OPTIMIZED']) });
adminRouter.patch(
  '/settings/routing-strategy',
  requireAuth,
  requireRole('SUPER_ADMIN', 'OPS_MANAGER'),
  handler(async (req, res) => {
    const b = strategySchema.parse(req.body);
    // Store the plain string so the router can read it back (no double-JSON).
    await prisma.pricingConfig.upsert({
      where: { key: 'ROUTING_STRATEGY' },
      update: { value: b.strategy },
      create: { key: 'ROUTING_STRATEGY', value: b.strategy },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'settings.routing-strategy',
        entity: 'PricingConfig',
        entityId: 'ROUTING_STRATEGY',
        after: { strategy: b.strategy },
      },
    });
    res.json(ok({ strategy: b.strategy, persisted: true }));
  }),
);

// GET /api/admin/dashboard — KPI snapshot (U15 skeleton).
adminRouter.get(
  '/dashboard',
  requireAuth,
  requireRole('SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'HUB_MANAGER', 'FINANCE'),
  handler(async (_req, res) => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    // Revenue counts only PAID shipments (audit defect #3).
    const [bookedToday, inTransit, delivered, exceptions, pendingPickups, openTickets, financials] = await Promise.all([
      prisma.shipment.count({ where: { createdAt: { gte: today } } }),
      prisma.shipment.count({ where: { status: 'IN_TRANSIT' } }),
      prisma.shipment.count({ where: { status: 'DELIVERED' } }),
      prisma.trackingEvent.count({ where: { kind: 'EXCEPTION' } }),
      prisma.shipment.count({ where: { status: { in: ['BOOKED', 'PICKUP_SCHEDULED'] } } }),
      prisma.ticket.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] } } }),
      prisma.shipmentFinancial.findMany({
        where: { shipment: { paymentStatus: 'PAID' } },
      }),
    ]);
    const totalRevenue = financials.reduce((sum, r) => sum + Number(r.customerPrice), 0);
    const totalTax = financials.reduce((sum, r) => sum + Number(r.tax), 0);
    const totalPartnerCost = financials.reduce((sum, r) => sum + Number(r.partnerCost), 0);
    const totalOwnCost = financials.reduce((sum, r) => sum + Number(r.ownCost), 0);
    const totalRefunded = financials.reduce((sum, r) => sum + Number(r.refunded), 0);
    const netMargin = totalRevenue - totalTax - totalPartnerCost - totalOwnCost - totalRefunded;
    res.json(
      ok({
        bookedToday,
        inTransit,
        delivered,
        exceptions,
        pendingPickups,
        openTickets,
        revenue: Math.round(totalRevenue * 100) / 100,
        partnerCost: Math.round(totalPartnerCost * 100) / 100,
        refunded: Math.round(totalRefunded * 100) / 100,
        netMargin: Math.round(netMargin * 100) / 100,
      }),
    );
  }),
);

// POST /api/admin/dev/mock-advance/:externalAwb — Mock partner simulator
// (U7 dev hook). Dev-only: refuses to run in production and requires staff.
adminRouter.post(
  '/dev/mock-advance/:externalAwb',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  handler(async (req, res) => {
    if (process.env.NODE_ENV === 'production')
      throw ApiError.badRequest('DEV_HOOK_DISABLED', 'The mock simulator is not available in production');
    const { MockCarrierAdapter } = await import('../lib/carriers/adapters/mock.adapter');
    const point = await MockCarrierAdapter.advance(req.params.externalAwb);
    res.json(ok({ advanced: point.status, at: point.eventTime }));
  }),
);

// ---------------------------------------------------------------------------
// Staff / Employee User Management (SUPER_ADMIN only)
// ---------------------------------------------------------------------------

adminRouter.get(
  '/users',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  handler(async (_req, res) => {
    const [users, cities] = await Promise.all([
      prisma.user.findMany({
        include: {
          roles: { include: { role: true } },
          agent: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.city.findMany({ select: { id: true, name: true } }),
    ]);
    const cityMap = new Map(cities.map((c) => [c.id, c.name]));
    res.json(
      ok(
        users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          isActive: u.isActive,
          isEmailVerified: u.isEmailVerified,
          hasPassword: Boolean(u.passwordHash),
          role: u.roles[0]?.role.name ?? 'CUSTOMER',
          agentCity: u.agent ? cityMap.get(u.agent.cityId) ?? null : null,
          createdAt: u.createdAt,
        })),
      ),
    );
  }),
);

const createStaffUserSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().email(),
  phone: z.string().trim().min(5).optional(),
  password: z.string().min(8),
  role: z.enum([
    'AGENT',
    'HUB_MANAGER',
    'SUPERVISOR',
    'SUPPORT',
    'FINANCE',
    'CITY_MANAGER',
    'OPS_MANAGER',
    'SUPER_ADMIN',
    'CUSTOMER',
  ]),
  cityId: z.string().optional(),
});

adminRouter.post(
  '/users',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  handler(async (req, res) => {
    const b = createStaffUserSchema.parse(req.body);
    const cleanEmail = normalizeEmail(b.email);
    validatePasswordStrength(b.password);

    const dup = await prisma.user.findFirst({
      where: {
        OR: [{ email: cleanEmail }, ...(b.phone ? [{ phone: b.phone.trim() }] : [])],
      },
    });
    if (dup) throw ApiError.badRequest('DUPLICATE_USER', 'Email or phone already registered');

    const roleRow = await prisma.role.findUnique({ where: { name: b.role } });
    if (!roleRow) throw ApiError.badRequest('ROLE_NOT_FOUND', `Role ${b.role} not found`);

    const passwordHash = await bcrypt.hash(b.password, 10);
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: b.name.trim(),
          email: cleanEmail,
          phone: b.phone?.trim() ?? null,
          passwordHash,
          isEmailVerified: true,
          isActive: true,
        },
      });
      await tx.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });
      if (b.role === 'CUSTOMER') {
        await tx.customer.create({ data: { userId: user.id, type: 'INDIVIDUAL' } });
      }
      if (b.role === 'AGENT') {
        const defaultCity =
          b.cityId ??
          (await tx.city.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } }))?.id;
        if (defaultCity) {
          await tx.agent.create({ data: { userId: user.id, cityId: defaultCity, isOnline: true } });
        }
      }
      return user;
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'admin.user_create',
        entity: 'User',
        entityId: created.id,
        after: { email: cleanEmail, role: b.role },
      },
    });

    res.status(201).json(
      ok({
        id: created.id,
        name: created.name,
        email: created.email,
        phone: created.phone,
        role: b.role,
      }),
    );
  }),
);

adminRouter.patch(
  '/users/:id/status',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  handler(async (req, res) => {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
    if (req.params.id === req.auth.userId && !isActive) {
      throw ApiError.badRequest('SELF_DISABLE_BLOCKED', 'Cannot disable your own active Super Admin session');
    }
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive },
    });
    if (!isActive) {
      await revokeAllRefreshTokens(updated.id);
    }
    res.json(ok({ id: updated.id, isActive: updated.isActive }));
  }),
);

// ---------------------------------------------------------------------------
// Audit Log Viewer, Webhook Inspector, Company Branding & Network Overview
// ---------------------------------------------------------------------------

adminRouter.get(
  '/audit-logs',
  requireAuth,
  requireRole('SUPER_ADMIN', 'OPS_MANAGER', 'FINANCE'),
  handler(async (req, res) => {
    const actionFilter = typeof req.query.action === 'string' && req.query.action.trim() ? req.query.action.trim() : undefined;
    const logs = await prisma.auditLog.findMany({
      where: actionFilter ? { action: { contains: actionFilter, mode: 'insensitive' } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const actorIds = Array.from(new Set(logs.map((l) => l.actorUserId).filter(Boolean) as string[]));
    const users = actorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    res.json(
      ok(
        logs.map((l) => ({
          ...l,
          actor: l.actorUserId ? userMap.get(l.actorUserId) ?? null : null,
        })),
      ),
    );
  }),
);

adminRouter.get(
  '/webhooks',
  requireAuth,
  requireRole('SUPER_ADMIN', 'OPS_MANAGER'),
  handler(async (_req, res) => {
    const rows = await prisma.webhookLog.findMany({
      orderBy: { receivedAt: 'desc' },
      take: 60,
    });
    res.json(ok(rows));
  }),
);

adminRouter.get(
  '/settings/company',
  requireAuth,
  requireRole('SUPER_ADMIN', 'OPS_MANAGER', 'FINANCE'),
  handler(async (_req, res) => {
    const row = await prisma.pricingConfig.findUnique({ where: { key: 'COMPANY_PROFILE' } });
    const profile = (row?.value as Record<string, string>) ?? {
      brandName: 'BookCourier Express Logistics',
      gstin: '29AABCB1234F1Z5',
      address: '12, MG Road, Bengaluru, Karnataka - 560001',
      supportEmail: 'support@bookcourier.local',
      supportPhone: '+91 80 4567 8900',
    };
    res.json(
      ok({
        profile,
        channels: {
          smsProvider: process.env.SMS_PROVIDER ?? 'console',
          emailProvider: process.env.EMAIL_PROVIDER ?? 'console',
          paymentGateway: process.env.RAZORPAY_KEY_ID ? 'RAZORPAY_LIVE_TEST' : 'MOCK_SANDBOX',
        },
      }),
    );
  }),
);

const companyProfileSchema = z.object({
  brandName: z.string().trim().min(2),
  gstin: z.string().trim().min(10),
  address: z.string().trim().min(5),
  supportEmail: z.string().trim().email(),
  supportPhone: z.string().trim().min(5),
});

adminRouter.patch(
  '/settings/company',
  requireAuth,
  requireRole('SUPER_ADMIN', 'FINANCE'),
  handler(async (req, res) => {
    const b = companyProfileSchema.parse(req.body);
    await prisma.pricingConfig.upsert({
      where: { key: 'COMPANY_PROFILE' },
      update: { value: b as never },
      create: { key: 'COMPANY_PROFILE', value: b as never },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'settings.company_profile',
        entity: 'PricingConfig',
        entityId: 'COMPANY_PROFILE',
        after: b,
      },
    });
    res.json(ok({ profile: b }));
  }),
);

adminRouter.get(
  '/network-overview',
  requireAuth,
  requireRole('SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'HUB_MANAGER'),
  handler(async (_req, res) => {
    const [cities, hubs, vehicles, carriers, openNdr, manifests] = await Promise.all([
      prisma.city.findMany({ include: { _count: { select: { pincodes: true, hubs: true } } }, orderBy: { name: 'asc' } }),
      prisma.hub.findMany({ include: { city: { select: { name: true, state: true } } } }),
      prisma.vehicle.findMany(),
      prisma.carrier.findMany({ select: { id: true, code: true, name: true, type: true, isEnabled: true } }),
      prisma.shipment.count({ where: { status: { in: ['DELIVERY_FAILED', 'PICKUP_FAILED', 'RTO_INITIATED'] } } }),
      prisma.manifest.findMany({ orderBy: { createdAt: 'desc' }, take: 15, include: { _count: { select: { items: true } } } }),
    ]);
    res.json(ok({ cities, hubs, vehicles, carriers, openNdr, manifests }));
  }),
);
