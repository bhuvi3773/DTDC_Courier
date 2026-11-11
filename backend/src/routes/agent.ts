import { Router } from 'express';
import { z } from 'zod';
import { Prisma, TaskStatus, TaskType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ok, handler, ApiError } from '../lib/errors';
import { requireAuth, requireRole } from '../lib/auth';
import { recordEvent, ALLOWED_TRANSITIONS, TERMINAL_STATUSES } from '../lib/tracking';
import { issueDeliveryOtp, verifyDeliveryOtp, failDeliveryAttempt } from '../lib/delivery-otp';
import { ensurePickupScheduled, hydrateTasks, resolveShipment } from '../lib/operations';
import { idempotent } from '../middleware/idempotency';

export const agentRouter = Router();

const ALLOWED_ROLES = ['AGENT', 'SUPERVISOR', 'HUB_MANAGER', 'OPS_MANAGER', 'SUPER_ADMIN'] as const;
const STAFF_ROLES = ['SUPERVISOR', 'HUB_MANAGER', 'OPS_MANAGER', 'SUPER_ADMIN'];

/** Resolve the agent record for the current caller (or fail for AGENT without profile). */
async function resolveCallerAgent(req: any) {
  const agent = await prisma.agent.findUnique({
    where: { userId: req.auth.userId },
    include: { user: { select: { id: true, name: true, phone: true } } },
  });
  if (!agent && req.auth.role === 'AGENT') {
    throw ApiError.forbidden('No agent profile linked to this account', 'AGENT_NOT_FOUND');
  }
  return agent;
}

/** Assert the caller owns this task (or is supervisory staff). */
async function loadOwnedTask(req: any, taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw ApiError.notFound('Task');

  const isStaff = STAFF_ROLES.includes(req.auth.role);
  if (!isStaff) {
    const agent = await resolveCallerAgent(req);
    if (!agent) throw ApiError.forbidden('Agent profile required', 'AGENT_NOT_FOUND');
    if (task.agentId && task.agentId !== agent.id) {
      throw ApiError.forbidden('This task is assigned to another agent', 'TASK_NOT_OWNED');
    }
    return { task, agent, isStaff: false };
  }
  const agent = task.agentId
    ? await prisma.agent.findUnique({ where: { id: task.agentId } })
    : await resolveCallerAgent(req);
  return { task, agent, isStaff: true };
}

// GET /api/agent/profile
agentRouter.get(
  '/profile',
  requireAuth,
  requireRole(...ALLOWED_ROLES),
  handler(async (req, res) => {
    const agent = await resolveCallerAgent(req);
    const isStaff = STAFF_ROLES.includes(req.auth.role);
    let city = null;
    if (agent) {
      city = await prisma.city.findUnique({ where: { id: agent.cityId } });
    }
    const taskCounts = agent
      ? await prisma.task.groupBy({
          by: ['status'],
          where: { agentId: agent.id },
          _count: { id: true },
        })
      : [];

    res.json(
      ok({
        agent: agent
          ? {
              id: agent.id,
              userId: agent.userId,
              name: agent.user.name,
              phone: agent.user.phone,
              cityId: agent.cityId,
              cityName: city?.name ?? null,
              isOnline: agent.isOnline,
            }
          : null,
        isStaff,
        stats: Object.fromEntries(taskCounts.map((c) => [c.status, c._count.id])),
      }),
    );
  }),
);

// POST /api/agent/availability — toggle online status
const availSchema = z.object({
  isOnline: z.boolean(),
  agentId: z.string().optional(),
});

agentRouter.post(
  '/availability',
  requireAuth,
  requireRole(...ALLOWED_ROLES),
  handler(async (req, res) => {
    const b = availSchema.parse(req.body);
    let agent = await resolveCallerAgent(req);
    if (!agent && b.agentId && STAFF_ROLES.includes(req.auth.role)) {
      agent = await prisma.agent.findUnique({
        where: { id: b.agentId },
        include: { user: { select: { id: true, name: true, phone: true } } },
      });
    }
    if (!agent) throw ApiError.badRequest('AGENT_NOT_FOUND', 'No agent profile available to update');

    const updated = await prisma.agent.update({
      where: { id: agent.id },
      data: { isOnline: b.isOnline },
    });
    res.json(ok({ id: updated.id, isOnline: updated.isOnline }));
  }),
);

// GET /api/agent/tasks — agent's assigned tasks (+ optional unassigned city pool)
agentRouter.get(
  '/tasks',
  requireAuth,
  requireRole(...ALLOWED_ROLES),
  handler(async (req, res) => {
    const agent = await resolveCallerAgent(req);
    const isStaff = STAFF_ROLES.includes(req.auth.role);
    const includeUnassigned = req.query.includeUnassigned === 'true';
    const filterAgentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
    const statusFilter = typeof req.query.status === 'string' && req.query.status ? (req.query.status as TaskStatus) : undefined;
    const typeFilter = typeof req.query.type === 'string' && req.query.type ? (req.query.type as TaskType) : undefined;

    const where: Prisma.TaskWhereInput = {};
    if (statusFilter) where.status = statusFilter;
    if (typeFilter) where.type = typeFilter;

    if (includeUnassigned) {
      where.agentId = null;
      if (!statusFilter) where.status = 'ASSIGNED';
    } else if (isStaff) {
      if (filterAgentId) where.agentId = filterAgentId;
    } else if (agent) {
      where.agentId = agent.id;
    }

    const tasks = await prisma.task.findMany({
      where,
      include: { agent: { include: { user: { select: { id: true, name: true, phone: true } } } } },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });

    const hydrated = await hydrateTasks(tasks);
    res.json(ok(hydrated));
  }),
);

// POST /api/agent/tasks/:taskId/accept — accept/claim an assigned or pool task
agentRouter.post(
  '/tasks/:taskId/accept',
  requireAuth,
  requireRole(...ALLOWED_ROLES),
  handler(async (req, res) => {
    const { task, agent, isStaff } = await loadOwnedTask(req, req.params.taskId);
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
      throw ApiError.unprocessable(`Task is already ${task.status}`, 'TASK_CLOSED');
    }

    const shipment = await prisma.shipment.findUnique({ where: { id: task.shipmentId }, select: { status: true } });
    if (shipment && TERMINAL_STATUSES.includes(shipment.status)) {
      throw ApiError.unprocessable(`Cannot accept task for ${shipment.status} shipment`, 'SHIPMENT_TERMINAL');
    }

    const bodyAgentId = (req.body as { agentId?: string } | undefined)?.agentId;
    const claimingAgentId =
      task.agentId ?? agent?.id ?? (isStaff && bodyAgentId ? bodyAgentId : undefined);
    if (!claimingAgentId) {
      throw ApiError.badRequest('AGENT_REQUIRED', 'Cannot accept task without an agent profile');
    }

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        agentId: claimingAgentId,
        status: 'ACCEPTED',
      },
    });

    if (task.type === 'PICKUP') {
      await ensurePickupScheduled(task.shipmentId, req.auth.userId, 'Accepted by pickup agent');
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'agent.task_accept',
        entity: 'Task',
        entityId: task.id,
        after: { agentId: claimingAgentId, shipmentId: task.shipmentId },
      },
    });

    res.json(ok(updated));
  }),
);

// POST /api/agent/pickup/:taskId/confirm — confirm physical first-mile pickup
const pickupConfirmSchema = z.object({
  remarks: z.string().optional(),
  proofUrl: z.string().optional(),
  locationLabel: z.string().optional(),
});

agentRouter.post(
  '/pickup/:taskId/confirm',
  requireAuth,
  requireRole(...ALLOWED_ROLES),
  idempotent('agent.pickup.confirm'),
  handler(async (req, res) => {
    const b = pickupConfirmSchema.parse(req.body ?? {});
    const { task, agent } = await loadOwnedTask(req, req.params.taskId);
    if (task.type !== 'PICKUP') {
      throw ApiError.badRequest('WRONG_TASK_TYPE', 'This endpoint is only for PICKUP tasks');
    }
    if (task.status === 'COMPLETED') {
      throw ApiError.unprocessable('Pickup task is already completed', 'TASK_ALREADY_COMPLETED');
    }

    const shipment = await prisma.shipment.findUnique({
      where: { id: task.shipmentId },
      include: { legs: { where: { carrierType: 'OWN' }, orderBy: { sequence: 'asc' }, take: 1 } },
    });
    if (!shipment) throw ApiError.notFound('Shipment');

    // Guard transition matrix: BOOKED -> PICKUP_SCHEDULED -> PICKED_UP
    if (shipment.status === 'BOOKED' || shipment.status === 'PICKUP_FAILED') {
      await ensurePickupScheduled(shipment.id, req.auth.userId, 'Scheduled for immediate pickup');
    }

    const ev = await recordEvent({
      shipmentId: shipment.id,
      legId: shipment.legs[0]?.id,
      kind: 'STATUS',
      status: 'PICKED_UP',
      source: 'AGENT_APP',
      actorUserId: req.auth.userId,
      locationLabel: b.locationLabel ?? 'Sender Doorstep',
      remarks: b.remarks ?? 'Picked up by courier agent',
      proofUrl: b.proofUrl,
      eventTime: new Date(),
    });

    const completed = await prisma.task.update({
      where: { id: task.id },
      data: {
        agentId: task.agentId ?? agent?.id ?? null,
        status: 'COMPLETED',
        proofUrl: b.proofUrl ?? null,
        completedAt: new Date(),
      },
    });

    res.json(ok({ task: completed, shipmentStatus: ev.shipmentStatus, eventId: ev.event.id }));
  }),
);

// POST /api/agent/pickup/:taskId/fail — record pickup attempt failure
const failSchema = z.object({
  reason: z.string().min(3, 'Failure reason is required'),
  exceptionCode: z.string().optional(),
  rescheduleFor: z.string().datetime().optional(),
});

agentRouter.post(
  '/pickup/:taskId/fail',
  requireAuth,
  requireRole(...ALLOWED_ROLES),
  handler(async (req, res) => {
    const b = failSchema.parse(req.body ?? {});
    const { task } = await loadOwnedTask(req, req.params.taskId);
    if (task.type !== 'PICKUP') {
      throw ApiError.badRequest('WRONG_TASK_TYPE', 'This endpoint is only for PICKUP tasks');
    }

    const shipment = await prisma.shipment.findUnique({ where: { id: task.shipmentId } });
    if (!shipment) throw ApiError.notFound('Shipment');

    if (shipment.status === 'BOOKED') {
      await ensurePickupScheduled(shipment.id, req.auth.userId);
    }

    const ev = await recordEvent({
      shipmentId: shipment.id,
      kind: 'STATUS',
      status: 'PICKUP_FAILED',
      exceptionCode: b.exceptionCode,
      source: 'AGENT_APP',
      actorUserId: req.auth.userId,
      remarks: b.reason,
      eventTime: new Date(),
    });

    const failedTask = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'FAILED',
        failureReason: b.reason,
        scheduledFor: b.rescheduleFor ? new Date(b.rescheduleFor) : task.scheduledFor,
      },
    });

    res.json(ok({ task: failedTask, shipmentStatus: ev.shipmentStatus }));
  }),
);

// POST /api/agent/delivery/:taskId/start — move shipment to OUT_FOR_DELIVERY & issue OTP
agentRouter.post(
  '/delivery/:taskId/start',
  requireAuth,
  requireRole(...ALLOWED_ROLES),
  handler(async (req, res) => {
    const { task, agent } = await loadOwnedTask(req, req.params.taskId);
    if (task.type !== 'DELIVERY') {
      throw ApiError.badRequest('WRONG_TASK_TYPE', 'This endpoint is only for DELIVERY tasks');
    }

    const shipment = await prisma.shipment.findUnique({
      where: { id: task.shipmentId },
      include: { legs: { orderBy: { sequence: 'desc' }, take: 1 } },
    });
    if (!shipment) throw ApiError.notFound('Shipment');

    const activeLeg = shipment.legs[0];
    if (activeLeg?.carrierType === 'PARTNER') {
      throw ApiError.forbidden('Partner legs are handled by the partner carrier', 'PARTNER_LEG_NO_STATUS');
    }

    // If still at hub or in transit, advance to OUT_FOR_DELIVERY
    let deliveryOtp: { issued: boolean; code?: string } | undefined;
    if (shipment.status !== 'OUT_FOR_DELIVERY') {
      if (!ALLOWED_TRANSITIONS[shipment.status]?.includes('OUT_FOR_DELIVERY')) {
        throw ApiError.unprocessable(
          `Shipment status ${shipment.status} cannot go Out for Delivery`,
          'INVALID_TRANSITION',
        );
      }
      await recordEvent({
        shipmentId: shipment.id,
        legId: activeLeg?.id,
        kind: 'STATUS',
        status: 'OUT_FOR_DELIVERY',
        source: 'AGENT_APP',
        actorUserId: req.auth.userId,
        remarks: 'Agent out for doorstep delivery',
        eventTime: new Date(),
      });
    }

    deliveryOtp = await issueDeliveryOtp(shipment.id);

    const updatedTask = await prisma.task.update({
      where: { id: task.id },
      data: {
        agentId: task.agentId ?? agent?.id ?? null,
        status: 'IN_PROGRESS',
      },
    });

    res.json(ok({ task: updatedTask, shipmentStatus: 'OUT_FOR_DELIVERY', deliveryOtp }));
  }),
);

// POST /api/agent/delivery/:taskId/confirm — complete delivery with 6-digit OTP
const deliveryConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'A 6-digit delivery OTP code is required'),
});

agentRouter.post(
  '/delivery/:taskId/confirm',
  requireAuth,
  requireRole(...ALLOWED_ROLES),
  idempotent('agent.delivery.confirm'),
  handler(async (req, res) => {
    const b = deliveryConfirmSchema.parse(req.body ?? {});
    const { task, agent } = await loadOwnedTask(req, req.params.taskId);
    if (task.type !== 'DELIVERY') {
      throw ApiError.badRequest('WRONG_TASK_TYPE', 'This endpoint is only for DELIVERY tasks');
    }

    const result = await verifyDeliveryOtp(task.shipmentId, b.code, req.auth.userId);
    const updatedTask = await prisma.task.update({
      where: { id: task.id },
      data: {
        agentId: task.agentId ?? agent?.id ?? null,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    res.json(ok({ task: updatedTask, ...result, shipmentStatus: 'DELIVERED' }));
  }),
);

// POST /api/agent/delivery/:taskId/fail — fail delivery attempt (+ auto-RTO on max attempts)
agentRouter.post(
  '/delivery/:taskId/fail',
  requireAuth,
  requireRole(...ALLOWED_ROLES),
  handler(async (req, res) => {
    const b = failSchema.parse(req.body ?? {});
    const { task } = await loadOwnedTask(req, req.params.taskId);
    if (task.type !== 'DELIVERY') {
      throw ApiError.badRequest('WRONG_TASK_TYPE', 'This endpoint is only for DELIVERY tasks');
    }

    const failRes = await failDeliveryAttempt(
      task.shipmentId,
      req.auth.userId,
      b.reason,
      b.exceptionCode,
    );

    const failedTask = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'FAILED',
        failureReason: b.reason,
      },
    });

    res.json(ok({ task: failedTask, ...failRes }));
  }),
);

// POST /api/agent/scan — scan AWB or package barcode to inspect or execute next pickup/delivery action
const scanSchema = z.object({
  code: z.string().min(3),
  locationLabel: z.string().optional(),
  remarks: z.string().optional(),
});

agentRouter.post(
  '/scan',
  requireAuth,
  requireRole(...ALLOWED_ROLES),
  idempotent('agent.scan'),
  handler(async (req, res) => {
    const b = scanSchema.parse(req.body);
    const shipment = await resolveShipment(b.code);
    const agent = await resolveCallerAgent(req);
    const isStaff = STAFF_ROLES.includes(req.auth.role);

    const openTask = await prisma.task.findFirst({
      where: {
        shipmentId: shipment.id,
        status: { in: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] },
        ...(agent && !isStaff ? { OR: [{ agentId: agent.id }, { agentId: null }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!openTask) {
      throw ApiError.notFound('Active task for scanned parcel');
    }

    let actionTaken = 'INSPECTED';
    let deliveryOtp: { issued: boolean; code?: string } | undefined;
    let nextStatus = shipment.status;

    if (openTask.type === 'PICKUP' && ['BOOKED', 'PICKUP_SCHEDULED', 'PICKUP_FAILED'].includes(shipment.status)) {
      if (shipment.status === 'BOOKED' || shipment.status === 'PICKUP_FAILED') {
        await ensurePickupScheduled(shipment.id, req.auth.userId);
      }
      const ev = await recordEvent({
        shipmentId: shipment.id,
        kind: 'STATUS',
        status: 'PICKED_UP',
        source: 'AGENT_APP',
        actorUserId: req.auth.userId,
        locationLabel: b.locationLabel ?? 'Pickup Scan',
        remarks: b.remarks ?? `Scanned parcel ${b.code} for pickup`,
        eventTime: new Date(),
      });
      await prisma.task.update({
        where: { id: openTask.id },
        data: { agentId: openTask.agentId ?? agent?.id ?? null, status: 'COMPLETED', completedAt: new Date() },
      });
      actionTaken = 'PICKUP_CONFIRMED';
      nextStatus = ev.shipmentStatus;
    } else if (openTask.type === 'DELIVERY' && ['AT_DESTINATION_HUB', 'IN_TRANSIT', 'DELIVERY_FAILED'].includes(shipment.status)) {
      const ev = await recordEvent({
        shipmentId: shipment.id,
        kind: 'STATUS',
        status: 'OUT_FOR_DELIVERY',
        source: 'AGENT_APP',
        actorUserId: req.auth.userId,
        locationLabel: b.locationLabel ?? 'Delivery Scan',
        remarks: b.remarks ?? `Scanned parcel ${b.code} out for delivery`,
        eventTime: new Date(),
      });
      deliveryOtp = await issueDeliveryOtp(shipment.id);
      await prisma.task.update({
        where: { id: openTask.id },
        data: { agentId: openTask.agentId ?? agent?.id ?? null, status: 'IN_PROGRESS' },
      });
      actionTaken = 'OUT_FOR_DELIVERY_STARTED';
      nextStatus = ev.shipmentStatus;
    } else if (shipment.status === 'OUT_FOR_DELIVERY') {
      actionTaken = 'NEEDS_DELIVERY_OTP';
    }

    res.json(
      ok({
        actionTaken,
        awb: shipment.awb,
        shipmentId: shipment.id,
        shipmentStatus: nextStatus,
        taskId: openTask.id,
        taskType: openTask.type,
        deliveryOtp,
      }),
    );
  }),
);

