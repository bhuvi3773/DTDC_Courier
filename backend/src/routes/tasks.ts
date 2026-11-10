import { Router } from 'express';
import { z } from 'zod';
import { Prisma, TaskStatus, TaskType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ok, handler, ApiError } from '../lib/errors';
import { requireAuth, requireRole } from '../lib/auth';
import {
  assignTaskToAgent,
  autoAssignUnassignedTasks,
  createOperationalTask,
  ensurePickupScheduled,
  hydrateTasks,
} from '../lib/operations';

export const tasksRouter = Router();

const STAFF_TASK_ROLES = ['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'HUB_MANAGER', 'SUPERVISOR'] as const;

// GET /api/tasks/agents — list all field agents with load metrics
tasksRouter.get(
  '/agents',
  requireAuth,
  requireRole(...STAFF_TASK_ROLES, 'AGENT'),
  handler(async (_req, res) => {
    const [agents, cities] = await Promise.all([
      prisma.agent.findMany({
        include: {
          user: { select: { id: true, name: true, phone: true, isActive: true } },
          tasks: {
            where: { status: { in: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] } },
            select: { id: true, type: true, status: true },
          },
        },
      }),
      prisma.city.findMany(),
    ]);
    const cityMap = new Map(cities.map((c) => [c.id, c.name]));

    res.json(
      ok(
        agents.map((a) => ({
          id: a.id,
          userId: a.userId,
          name: a.user.name,
          phone: a.user.phone,
          isActive: a.user.isActive,
          cityId: a.cityId,
          cityName: cityMap.get(a.cityId) ?? a.cityId,
          isOnline: a.isOnline,
          activeTaskCount: a.tasks.length,
        })),
      ),
    );
  }),
);

// GET /api/tasks — list operational tasks with filters
tasksRouter.get(
  '/',
  requireAuth,
  requireRole(...STAFF_TASK_ROLES),
  handler(async (req, res) => {
    const statusFilter = typeof req.query.status === 'string' && req.query.status ? (req.query.status as TaskStatus) : undefined;
    const typeFilter = typeof req.query.type === 'string' && req.query.type ? (req.query.type as TaskType) : undefined;
    const unassigned = req.query.unassigned === 'true';

    const where: Prisma.TaskWhereInput = {};
    if (statusFilter) where.status = statusFilter;
    if (typeFilter) where.type = typeFilter;
    if (unassigned) where.agentId = null;

    const tasks = await prisma.task.findMany({
      where,
      include: { agent: { include: { user: { select: { id: true, name: true, phone: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json(ok(await hydrateTasks(tasks)));
  }),
);

// POST /api/tasks — create a task (PICKUP, DELIVERY, RTO_RETURN, HUB_TRANSFER)
const createSchema = z.object({
  type: z.enum(['PICKUP', 'DELIVERY', 'RTO_RETURN', 'HUB_TRANSFER']),
  shipmentId: z.string(),
  agentId: z.string().optional(),
  scheduledFor: z.string().datetime().optional(),
  dispatchNow: z.boolean().optional(),
});

tasksRouter.post(
  '/',
  requireAuth,
  requireRole(...STAFF_TASK_ROLES),
  handler(async (req, res) => {
    const b = createSchema.parse(req.body);
    const result = await createOperationalTask({
      type: b.type,
      shipmentId: b.shipmentId,
      agentId: b.agentId,
      scheduledFor: b.scheduledFor ? new Date(b.scheduledFor) : undefined,
      dispatchNow: b.dispatchNow,
      actorUserId: req.auth.userId,
    });
    res.status(201).json(ok(result));
  }),
);

// POST /api/tasks/auto-assign — distribute unassigned tasks to online city agents
tasksRouter.post(
  '/auto-assign',
  requireAuth,
  requireRole(...STAFF_TASK_ROLES),
  handler(async (req, res) => {
    const { cityId } = (req.body ?? {}) as { cityId?: string };
    const result = await autoAssignUnassignedTasks(req.auth.userId, cityId);
    res.json(ok(result));
  }),
);

// POST /api/tasks/:id/assign — assign or reassign agent to task
const assignSchema = z.object({
  agentId: z.string(),
  scheduledFor: z.string().datetime().optional(),
});

tasksRouter.post(
  '/:id/assign',
  requireAuth,
  requireRole(...STAFF_TASK_ROLES),
  handler(async (req, res) => {
    const b = assignSchema.parse(req.body);
    const task = await assignTaskToAgent(
      req.params.id,
      b.agentId,
      req.auth.userId,
      b.scheduledFor ? new Date(b.scheduledFor) : undefined,
    );
    res.json(ok(task));
  }),
);

// POST /api/tasks/:id/reschedule — reschedule failed or pending task
const rescheduleSchema = z.object({
  scheduledFor: z.string().datetime(),
  agentId: z.string().optional(),
  remarks: z.string().optional(),
});

tasksRouter.post(
  '/:id/reschedule',
  requireAuth,
  requireRole(...STAFF_TASK_ROLES),
  handler(async (req, res) => {
    const b = rescheduleSchema.parse(req.body);
    const existing = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('Task');

    const updated = await prisma.task.update({
      where: { id: existing.id },
      data: {
        scheduledFor: new Date(b.scheduledFor),
        agentId: b.agentId ?? existing.agentId,
        status: existing.status === 'FAILED' ? 'ASSIGNED' : existing.status,
      },
    });

    if (existing.type === 'PICKUP') {
      await ensurePickupScheduled(existing.shipmentId, req.auth.userId, b.remarks ?? 'Pickup rescheduled');
    }

    res.json(ok(updated));
  }),
);
