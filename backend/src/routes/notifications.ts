import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ok, handler, ApiError } from '../lib/errors';
import { requireAuth, requireRole } from '../lib/auth';
import { retryNotificationById } from '../lib/notifications';

export const notificationsRouter = Router();

const STAFF_ROLES = ['SUPER_ADMIN', 'OPS_MANAGER', 'SUPPORT', 'SUPERVISOR', 'HUB_MANAGER'];

/** GET /api/notifications — customer sees own/shipment notifications; staff sees all */
notificationsRouter.get(
  '/',
  requireAuth,
  handler(async (req, res) => {
    const isStaff = STAFF_ROLES.includes(req.auth.role);
    const statusFilter = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
    const channelFilter = typeof req.query.channel === 'string' && req.query.channel ? req.query.channel : undefined;

    const where: Prisma.NotificationWhereInput = {};
    if (statusFilter) where.status = statusFilter;
    if (channelFilter) where.channel = channelFilter;

    if (!isStaff) {
      const customer = await prisma.customer.findFirst({ where: { userId: req.auth.userId } });
      const ownShipments = customer
        ? await prisma.shipment.findMany({
            where: { customerId: customer.id },
            select: { id: true },
            take: 100,
          })
        : [];
      const shipIds = ownShipments.map((s) => s.id);
      const targets = [req.auth.user?.phone, req.auth.user?.email].filter(Boolean) as string[];

      where.OR = [
        ...(shipIds.length > 0 ? [{ shipmentId: { in: shipIds } }] : []),
        ...(targets.length > 0 ? [{ target: { in: targets } }] : []),
      ];
      if (where.OR.length === 0) {
        res.json(ok([]));
        return;
      }
    }

    const list = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json(ok(list));
  }),
);

/** POST /api/notifications/:id/retry — re-send a failed/queued notification */
notificationsRouter.post(
  '/:id/retry',
  requireAuth,
  requireRole('SUPER_ADMIN', 'OPS_MANAGER', 'SUPPORT', 'SUPERVISOR'),
  handler(async (req, res) => {
    const updated = await retryNotificationById(req.params.id);
    if (!updated) throw ApiError.notFound('Notification');
    res.json(ok(updated));
  }),
);

