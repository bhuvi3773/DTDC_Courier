import { Prisma, TaskStatus, TaskType } from '@prisma/client';
import { prisma } from './prisma';
import { ApiError } from './errors';
import { recordEvent, ALLOWED_TRANSITIONS, TERMINAL_STATUSES } from './tracking';
import { issueDeliveryOtp } from './delivery-otp';

export const OPEN_TASK_STATUSES: TaskStatus[] = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'];

/**
 * Resolve a shipment by Shipment UUID, AWB string, or Package barcode (e.g. BC...-1).
 */
export async function resolveShipment(idOrCode: string) {
  const code = idOrCode.trim();
  if (!code) throw ApiError.badRequest('CODE_REQUIRED', 'Shipment ID, AWB, or barcode is required');

  let shipment = await prisma.shipment.findFirst({
    where: {
      OR: [{ id: code }, { awb: code.toUpperCase() }, { awb: code }],
    },
    include: { legs: { orderBy: { sequence: 'asc' } }, packages: true },
  });

  if (!shipment) {
    const pkg = await prisma.package.findFirst({
      where: {
        OR: [{ barcode: code.toUpperCase() }, { barcode: code }],
      },
    });
    if (pkg) {
      shipment = await prisma.shipment.findUnique({
        where: { id: pkg.shipmentId },
        include: { legs: { orderBy: { sequence: 'asc' } }, packages: true },
      });
    }
  }

  if (!shipment) throw ApiError.notFound(`Shipment (${code})`);
  return shipment;
}

/**
 * Hydrate an array of Task rows with their associated Shipment, Addresses,
 * Packages, and assigned Agent details in batched queries (no N+1).
 */
export async function hydrateTasks(
  tasks: Array<
    Prisma.TaskGetPayload<{
      include: { agent: { include: { user: { select: { id: true; name: true; phone: true } } } } };
    }>
  >,
) {
  if (tasks.length === 0) return [];

  const shipmentIds = Array.from(new Set(tasks.map((t) => t.shipmentId)));
  const shipments = await prisma.shipment.findMany({
    where: { id: { in: shipmentIds } },
    include: {
      packages: true,
      legs: { orderBy: { sequence: 'asc' } },
    },
  });

  const addressIds = Array.from(
    new Set(shipments.flatMap((s) => [s.pickupAddressId, s.deliveryAddressId])),
  );
  const addresses = await prisma.address.findMany({ where: { id: { in: addressIds } } });

  const shipmentMap = new Map(shipments.map((s) => [s.id, s]));
  const addressMap = new Map(addresses.map((a) => [a.id, a]));

  return tasks.map((task) => {
    const shipment = shipmentMap.get(task.shipmentId) ?? null;
    const pickupAddress = shipment ? addressMap.get(shipment.pickupAddressId) ?? null : null;
    const deliveryAddress = shipment ? addressMap.get(shipment.deliveryAddressId) ?? null : null;

    return {
      ...task,
      agentName: task.agent?.user.name ?? null,
      agentPhone: task.agent?.user.phone ?? null,
      shipment: shipment
        ? {
            id: shipment.id,
            awb: shipment.awb,
            status: shipment.status,
            serviceType: shipment.serviceType,
            shipmentType: shipment.shipmentType,
            paymentStatus: shipment.paymentStatus,
            bookCount: shipment.bookCount,
            parcelCount: shipment.parcelCount,
            packages: shipment.packages,
            legs: shipment.legs,
            pickupAddress,
            deliveryAddress,
          }
        : null,
    };
  });
}

/**
 * Ensure a shipment advances to PICKUP_SCHEDULED if currently BOOKED or PICKUP_FAILED.
 */
export async function ensurePickupScheduled(shipmentId: string, actorUserId: string, remarks?: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw ApiError.notFound('Shipment');

  if (shipment.status === 'BOOKED' || shipment.status === 'PICKUP_FAILED') {
    await recordEvent({
      shipmentId: shipment.id,
      kind: 'STATUS',
      status: 'PICKUP_SCHEDULED',
      source: 'ADMIN',
      actorUserId,
      remarks: remarks ?? 'Pickup task scheduled/assigned',
      eventTime: new Date(),
    });
  }
}

/**
 * Assign or reassign a task to an agent, updating shipment tracking state as needed.
 */
export async function assignTaskToAgent(
  taskId: string,
  agentId: string,
  actorUserId: string,
  scheduledFor?: Date,
) {
  const [task, agent] = await Promise.all([
    prisma.task.findUnique({ where: { id: taskId } }),
    prisma.agent.findUnique({
      where: { id: agentId },
      include: { user: { select: { name: true, phone: true } } },
    }),
  ]);
  if (!task) throw ApiError.notFound('Task');
  if (!agent) throw ApiError.notFound('Agent');
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
    throw ApiError.unprocessable(`Cannot reassign a ${task.status} task`, 'TASK_IMMUTABLE');
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      agentId: agent.id,
      status: task.status === 'FAILED' ? 'ASSIGNED' : task.status,
      scheduledFor: scheduledFor ?? task.scheduledFor,
      attemptNo: task.status === 'FAILED' ? task.attemptNo + 1 : task.attemptNo,
    },
  });

  if (task.type === 'PICKUP') {
    await ensurePickupScheduled(task.shipmentId, actorUserId, `Assigned to ${agent.user.name}`);
  }

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'task.assign',
      entity: 'Task',
      entityId: task.id,
      after: { agentId: agent.id, agentName: agent.user.name, shipmentId: task.shipmentId },
    },
  });

  return updated;
}

/**
 * Reuse an existing open task for `(shipmentId, type)` instead of creating
 * duplicates, cancelling any extra stale copies found for the same tuple.
 */
export async function ensureOpenTask(input: {
  type: TaskType;
  shipmentId: string;
  agentId?: string;
  scheduledFor?: Date;
}) {
  const openTasks = await prisma.task.findMany({
    where: {
      shipmentId: input.shipmentId,
      type: input.type,
      status: { in: OPEN_TASK_STATUSES },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (openTasks.length > 0) {
    let task = openTasks[0];
    if (openTasks.length > 1) {
      await prisma.task.updateMany({
        where: { id: { in: openTasks.slice(1).map((t) => t.id) } },
        data: { status: 'CANCELLED' },
      });
    }
    const patch: Prisma.TaskUpdateInput = {};
    if (input.agentId && !task.agentId) patch.agent = { connect: { id: input.agentId } };
    if (input.scheduledFor && !task.scheduledFor) patch.scheduledFor = input.scheduledFor;
    if (Object.keys(patch).length > 0) {
      task = await prisma.task.update({ where: { id: task.id }, data: patch });
    }
    return { task, created: false };
  }

  const task = await prisma.task.create({
    data: {
      type: input.type,
      shipmentId: input.shipmentId,
      agentId: input.agentId ?? null,
      status: 'ASSIGNED',
      scheduledFor: input.scheduledFor ?? null,
    },
  });
  return { task, created: true };
}

/**
 * Create a new operational task for a shipment (idempotently reusing an
 * existing open task of the same type when one already exists).
 */
export async function createOperationalTask(input: {
  type: TaskType;
  shipmentId: string;
  agentId?: string;
  scheduledFor?: Date;
  dispatchNow?: boolean;
  actorUserId: string;
}) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: input.shipmentId },
    include: { legs: { orderBy: { sequence: 'desc' }, take: 1 } },
  });
  if (!shipment) throw ApiError.notFound('Shipment');

  if (TERMINAL_STATUSES.includes(shipment.status)) {
    throw ApiError.unprocessable(
      `Cannot create ${input.type} task when shipment is ${shipment.status}`,
      'SHIPMENT_TERMINAL',
    );
  }
  if (input.type === 'PICKUP' && !['BOOKED', 'PICKUP_SCHEDULED', 'PICKUP_FAILED'].includes(shipment.status)) {
    throw ApiError.unprocessable(
      `Cannot create PICKUP task when shipment is ${shipment.status}`,
      'INVALID_STATUS_FOR_PICKUP_TASK',
    );
  }
  if (input.type === 'DELIVERY' && ['BOOKED', 'PICKUP_SCHEDULED', 'PICKUP_FAILED'].includes(shipment.status)) {
    throw ApiError.unprocessable(
      `Cannot create DELIVERY task before parcel is in transit (status: ${shipment.status})`,
      'INVALID_STATUS_FOR_DELIVERY_TASK',
    );
  }

  if (input.agentId) {
    const agent = await prisma.agent.findUnique({ where: { id: input.agentId } });
    if (!agent) throw ApiError.notFound('Agent');
  }

  const { task } = await ensureOpenTask({
    type: input.type,
    shipmentId: shipment.id,
    agentId: input.agentId,
    scheduledFor: input.scheduledFor,
  });

  if (input.type === 'PICKUP' && input.agentId) {
    await ensurePickupScheduled(shipment.id, input.actorUserId);
  }

  let deliveryOtp: { issued: boolean; code?: string } | undefined;
  if (input.type === 'DELIVERY' && input.dispatchNow) {
    const activeLeg = shipment.legs[0];
    if (activeLeg?.carrierType === 'PARTNER') {
      throw ApiError.forbidden('Partner leg cannot be dispatched manually via own fleet', 'PARTNER_LEG_NO_STATUS');
    }
    if (ALLOWED_TRANSITIONS[shipment.status]?.includes('OUT_FOR_DELIVERY')) {
      await recordEvent({
        shipmentId: shipment.id,
        legId: activeLeg?.id,
        kind: 'STATUS',
        status: 'OUT_FOR_DELIVERY',
        source: 'ADMIN',
        actorUserId: input.actorUserId,
        remarks: 'Dispatched for doorstep delivery',
        eventTime: new Date(),
      });
      if (!activeLeg || activeLeg.carrierType === 'OWN') {
        deliveryOtp = await issueDeliveryOtp(shipment.id);
      }
    }
  }

  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: 'task.create',
      entity: 'Task',
      entityId: task.id,
      after: { type: input.type, shipmentId: shipment.id, agentId: input.agentId ?? null },
    },
  });

  return { task, deliveryOtp };
}

/**
 * Auto-assign unassigned ASSIGNED tasks to agents in the relevant city,
 * prioritizing online agents with the lowest open task count.
 */
export async function autoAssignUnassignedTasks(actorUserId: string, cityIdFilter?: string) {
  const unassigned = await prisma.task.findMany({
    where: { agentId: null, status: 'ASSIGNED' },
    orderBy: { createdAt: 'asc' },
  });

  if (unassigned.length === 0) return { assignedCount: 0, assignments: [] };

  const agents = await prisma.agent.findMany({
    where: cityIdFilter ? { cityId: cityIdFilter } : undefined,
    include: {
      user: { select: { name: true, isActive: true } },
      tasks: {
        where: { status: { in: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] as TaskStatus[] } },
        select: { id: true },
      },
    },
  });

  const activeAgents = agents.filter((a) => a.user.isActive);
  if (activeAgents.length === 0) {
    return { assignedCount: 0, assignments: [], warning: 'No active agents available' };
  }

  const loadCount = new Map(activeAgents.map((a) => [a.id, a.tasks.length]));
  const shipments = await prisma.shipment.findMany({
    where: { id: { in: unassigned.map((t) => t.shipmentId) } },
  });
  const addrIds = Array.from(new Set(shipments.flatMap((s) => [s.pickupAddressId, s.deliveryAddressId])));
  const addresses = await prisma.address.findMany({ where: { id: { in: addrIds } } });
  const pincodes = await prisma.pincode.findMany({
    where: { pincode: { in: Array.from(new Set(addresses.map((a) => a.pincode))) } },
  });

  const shipMap = new Map(shipments.map((s) => [s.id, s]));
  const addrMap = new Map(addresses.map((a) => [a.id, a]));
  const pinCityMap = new Map(pincodes.map((p) => [p.pincode, p.cityId]));

  const assignments: Array<{ taskId: string; shipmentId: string; agentId: string; agentName: string }> = [];

  for (const task of unassigned) {
    const ship = shipMap.get(task.shipmentId);
    const addr = ship
      ? addrMap.get(task.type === 'DELIVERY' ? ship.deliveryAddressId : ship.pickupAddressId)
      : undefined;
    const targetCityId = addr ? pinCityMap.get(addr.pincode) : undefined;

    let candidates = targetCityId ? activeAgents.filter((a) => a.cityId === targetCityId) : activeAgents;
    if (candidates.length === 0) candidates = activeAgents;

    const onlineCandidates = candidates.filter((a) => a.isOnline);
    const pool = onlineCandidates.length > 0 ? onlineCandidates : candidates;

    pool.sort((a, b) => (loadCount.get(a.id) ?? 0) - (loadCount.get(b.id) ?? 0));
    const chosen = pool[0];
    if (!chosen) continue;

    await assignTaskToAgent(task.id, chosen.id, actorUserId);
    loadCount.set(chosen.id, (loadCount.get(chosen.id) ?? 0) + 1);
    assignments.push({
      taskId: task.id,
      shipmentId: task.shipmentId,
      agentId: chosen.id,
      agentName: chosen.user.name,
    });
  }

  return { assignedCount: assignments.length, assignments };
}

