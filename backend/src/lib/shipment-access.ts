import { Shipment } from '@prisma/client';
import { prisma } from './prisma';
import { ApiError } from './errors';

/** Roles allowed to read ANY shipment (staff / ops). */
const STAFF_READ_ROLES = [
  'SUPER_ADMIN',
  'OPS_MANAGER',
  'CITY_MANAGER',
  'HUB_MANAGER',
  'SUPERVISOR',
  'FINANCE',
  'SUPPORT',
  'ACCOUNT_MANAGER',
];

export interface ReqAuth {
  userId: string;
  role: string;
  permissions: string[];
}

/**
 * Assert the caller may read `shipment` (audit defect #1).
 *  - staff roles may read any shipment;
 *  - CUSTOMER may only read their own;
 *  - AGENT may only read shipments they have a task on.
 */
export async function assertShipmentReadable(auth: ReqAuth, shipment: Shipment) {
  if (STAFF_READ_ROLES.includes(auth.role)) return;

  if (auth.role === 'CUSTOMER') {
    const customer = await prisma.customer.findFirst({ where: { userId: auth.userId } });
    if (!customer || shipment.customerId !== customer.id) {
      throw ApiError.forbidden('You can only view your own shipments', 'SHIPMENT_NOT_OWNED');
    }
    return;
  }

  if (auth.role === 'AGENT') {
    const agent = await prisma.agent.findUnique({ where: { userId: auth.userId } });
    if (!agent) throw ApiError.forbidden('No agent profile', 'AGENT_NOT_FOUND');
    const task = await prisma.task.findFirst({
      where: { shipmentId: shipment.id, agentId: agent.id },
      select: { id: true },
    });
    if (!task) throw ApiError.forbidden('Shipment not assigned to you', 'SHIPMENT_NOT_OWNED');
    return;
  }

  throw ApiError.forbidden('Insufficient role to read this shipment', 'ROLE_FORBIDDEN');
}
