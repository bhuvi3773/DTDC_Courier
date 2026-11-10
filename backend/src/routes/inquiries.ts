import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ok, handler } from '../lib/errors';
import { optionalAuth, requireAuth, requireRole } from '../lib/auth';

export const inquiriesRouter = Router();

const createInquirySchema = z.object({
  customerName: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().min(5),
  companyName: z.string().trim().optional(),
  solutionType: z.enum([
    '3PL_WAREHOUSING',
    'FTL_CHARTER',
    'FRANCHISE_PARTNER',
    'TEMPERATURE_CONTROLLED',
    'ONDC_ECOMMERCE',
    'B2B_CONTRACT',
  ]),
  originCity: z.string().trim().optional(),
  destCity: z.string().trim().optional(),
  monthlyVolume: z.string().trim().optional(),
  temperatureRange: z.string().trim().optional(),
  notes: z.string().trim().min(5),
});

/** POST /api/inquiries — submit enterprise 3PL, FTL, Cold-Chain, ONDC or Franchise inquiry */
inquiriesRouter.post(
  '/',
  optionalAuth,
  handler(async (req, res) => {
    const b = createInquirySchema.parse(req.body);
    const created = await prisma.logisticsInquiry.create({
      data: {
        ...b,
        userId: req.auth?.userId ?? null,
        status: 'NEW',
      },
    });
    res.status(201).json(ok(created));
  }),
);

/** GET /api/inquiries — staff sees all enterprise leads; customer sees own submissions */
inquiriesRouter.get(
  '/',
  requireAuth,
  handler(async (req, res) => {
    const STAFF = ['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'SUPPORT', 'FINANCE'];
    const isStaff = STAFF.includes(req.auth.role);
    const rows = await prisma.logisticsInquiry.findMany({
      where: isStaff ? {} : { userId: req.auth.userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(ok(rows));
  }),
);

/** PATCH /api/inquiries/:id — update lead status & admin notes */
inquiriesRouter.patch(
  '/:id',
  requireAuth,
  requireRole('SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'SUPPORT'),
  handler(async (req, res) => {
    const b = z
      .object({
        status: z.enum(['NEW', 'CONTACTED', 'QUOTED', 'ACTIVE', 'CLOSED']),
        adminNotes: z.string().optional(),
      })
      .parse(req.body);

    const updated = await prisma.logisticsInquiry.update({
      where: { id: req.params.id },
      data: {
        status: b.status,
        ...(b.adminNotes !== undefined ? { adminNotes: b.adminNotes } : {}),
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'inquiry.update',
        entity: 'LogisticsInquiry',
        entityId: updated.id,
        after: b,
      },
    });
    res.json(ok(updated));
  }),
);

