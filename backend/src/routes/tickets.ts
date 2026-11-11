import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ok, handler, ApiError } from '../lib/errors';
import { requireAuth, requireRole } from '../lib/auth';
import { resolveShipment } from '../lib/operations';
import { dispatchNotification, DispatchNotificationInput } from '../lib/notifications';

export const ticketsRouter = Router();

const SUPPORT_STAFF_ROLES = ['SUPER_ADMIN', 'SUPPORT', 'OPS_MANAGER', 'SUPERVISOR', 'FINANCE'] as const;

async function safeTicketNotify(input: DispatchNotificationInput) {
  try {
    await dispatchNotification(input);
  } catch (err) {
    console.error('[ticket-notify] non-fatal error:', err);
  }
}

async function getClaimWindowDays(): Promise<number> {
  const row = await prisma.pricingConfig.findUnique({ where: { key: 'CLAIM_WINDOW_DAYS' } });
  const n = row ? Number(row.value) : 7;
  return Number.isFinite(n) && n > 0 ? n : 7;
}

/** GET /api/tickets — customer sees own tickets; staff sees all tickets */
ticketsRouter.get(
  '/',
  requireAuth,
  handler(async (req, res) => {
    const isStaff = (SUPPORT_STAFF_ROLES as readonly string[]).includes(req.auth.role);
    const statusFilter = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
    const typeFilter = typeof req.query.type === 'string' && req.query.type ? req.query.type : undefined;

    const where: Prisma.TicketWhereInput = {};
    if (statusFilter) where.status = statusFilter;
    if (typeFilter) where.type = typeFilter;

    if (!isStaff) {
      const customer = await prisma.customer.findFirst({ where: { userId: req.auth.userId } });
      if (!customer) {
        res.json(ok([]));
        return;
      }
      where.customerId = customer.id;
    }

    const tickets = await prisma.ticket.findMany({
      where,
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const shipIds = Array.from(new Set(tickets.map((t) => t.shipmentId).filter(Boolean) as string[]));
    const custIds = Array.from(new Set(tickets.map((t) => t.customerId)));

    const [shipments, customers] = await Promise.all([
      shipIds.length
        ? prisma.shipment.findMany({
            where: { id: { in: shipIds } },
            select: { id: true, awb: true, status: true, paymentStatus: true },
          })
        : [],
      custIds.length
        ? prisma.customer.findMany({
            where: { id: { in: custIds } },
            include: { user: { select: { name: true, phone: true, email: true } } },
          })
        : [],
    ]);

    const shipMap = new Map(shipments.map((s) => [s.id, s]));
    const custMap = new Map(customers.map((c) => [c.id, c]));

    res.json(
      ok(
        tickets.map((t) => ({
          id: t.id,
          shipmentId: t.shipmentId,
          customerId: t.customerId,
          subject: t.subject,
          status: t.status,
          type: t.type,
          createdAt: t.createdAt,
          messageCount: t._count.messages,
          lastMessage: t.messages[0]?.body ?? null,
          shipment: t.shipmentId ? shipMap.get(t.shipmentId) ?? null : null,
          customerName: custMap.get(t.customerId)?.user.name ?? null,
          customerPhone: custMap.get(t.customerId)?.user.phone ?? null,
        })),
      ),
    );
  }),
);

/** GET /api/tickets/:id — full thread detail (ownership/staff gated) */
ticketsRouter.get(
  '/:id',
  requireAuth,
  handler(async (req, res) => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) throw ApiError.notFound('Ticket');

    const isStaff = (SUPPORT_STAFF_ROLES as readonly string[]).includes(req.auth.role);
    if (!isStaff) {
      const customer = await prisma.customer.findFirst({ where: { userId: req.auth.userId } });
      if (!customer || ticket.customerId !== customer.id) {
        throw ApiError.forbidden('You can only inspect your own support tickets', 'TICKET_NOT_OWNED');
      }
    }

    const authorIds = Array.from(new Set(ticket.messages.map((m) => m.authorUserId)));
    const [authors, shipment] = await Promise.all([
      authorIds.length
        ? prisma.user.findMany({
            where: { id: { in: authorIds } },
            select: { id: true, name: true, roles: { include: { role: true } } },
          })
        : [],
      ticket.shipmentId
        ? prisma.shipment.findUnique({
            where: { id: ticket.shipmentId },
            include: { financial: true },
          })
        : null,
    ]);
    const authorMap = new Map(
      authors.map((u) => [u.id, { name: u.name, role: u.roles[0]?.role.name ?? 'CUSTOMER' }]),
    );

    res.json(
      ok({
        ...ticket,
        shipment: shipment
          ? {
              id: shipment.id,
              awb: shipment.awb,
              status: shipment.status,
              paymentStatus: shipment.paymentStatus,
              customerPrice: shipment.financial ? Number(shipment.financial.customerPrice) : null,
              refunded: shipment.financial ? Number(shipment.financial.refunded) : 0,
            }
          : null,
        messages: ticket.messages.map((m) => ({
          ...m,
          authorName: authorMap.get(m.authorUserId)?.name ?? 'User',
          authorRole: authorMap.get(m.authorUserId)?.role ?? 'CUSTOMER',
        })),
      }),
    );
  }),
);

/** POST /api/tickets — customer (or staff) opens a support ticket / damage claim */
const createTicketSchema = z.object({
  awbOrShipmentId: z.string().optional(),
  subject: z.string().min(3),
  type: z.enum(['COMPLAINT', 'DELAY', 'DAMAGE', 'LOST', 'WRONG_DELIVERY', 'BILLING', 'GENERAL']).default('COMPLAINT'),
  message: z.string().min(5),
});

ticketsRouter.post(
  '/',
  requireAuth,
  handler(async (req, res) => {
    const b = createTicketSchema.parse(req.body);
    let customer = await prisma.customer.findFirst({ where: { userId: req.auth.userId } });
    if (!customer) {
      customer = await prisma.customer.create({ data: { userId: req.auth.userId, type: 'INDIVIDUAL' } });
    }

    let resolvedShipmentId: string | null = null;
    let resolvedAwb: string | null = null;

    if (b.awbOrShipmentId && b.awbOrShipmentId.trim()) {
      const shipment = await resolveShipment(b.awbOrShipmentId.trim());
      const isStaff = (SUPPORT_STAFF_ROLES as readonly string[]).includes(req.auth.role);
      if (!isStaff && shipment.customerId !== customer.id) {
        throw ApiError.forbidden('You can only open tickets for your own shipments', 'SHIPMENT_NOT_OWNED');
      }

      // Unit U12: Enforce claim reporting deadline for damage / wrong delivery claims on DELIVERED shipments
      if (['DAMAGE', 'WRONG_DELIVERY'].includes(b.type) && shipment.status === 'DELIVERED') {
        const windowDays = await getClaimWindowDays();
        const ageDays = (Date.now() - shipment.statusUpdatedAt.getTime()) / 864e5;
        if (ageDays > windowDays) {
          throw ApiError.unprocessable(
            `Claim reporting window (${windowDays} days post-delivery) has expired`,
            'CLAIM_WINDOW_EXPIRED',
          );
        }
      }

      resolvedShipmentId = shipment.id;
      resolvedAwb = shipment.awb;
    }

    const ticket = await prisma.ticket.create({
      data: {
        shipmentId: resolvedShipmentId,
        customerId: customer.id,
        subject: b.subject.trim(),
        type: b.type,
        status: 'OPEN',
        messages: {
          create: {
            authorUserId: req.auth.userId,
            body: b.message.trim(),
          },
        },
      },
      include: { messages: true },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'ticket.create',
        entity: 'Ticket',
        entityId: ticket.id,
        after: { type: b.type, awb: resolvedAwb, subject: b.subject },
      },
    });

    const target = req.auth.user?.phone || req.auth.user?.email || 'support@bookcourier.local';
    await safeTicketNotify({
      shipmentId: resolvedShipmentId,
      channel: target.includes('@') ? 'EMAIL' : 'SMS',
      target,
      template: 'TICKET_CREATED',
      subject: `Ticket Opened: ${ticket.subject}`,
      message: `Support ticket opened (${ticket.type})${resolvedAwb ? ` for AWB ${resolvedAwb}` : ''}. Ref: ${ticket.id.slice(0, 8)}`,
    });

    res.status(201).json(ok(ticket));
  }),
);

/** POST /api/tickets/:id/messages — customer or staff posts a reply */
const replySchema = z.object({ body: z.string().min(1) });

ticketsRouter.post(
  '/:id/messages',
  requireAuth,
  handler(async (req, res) => {
    const b = replySchema.parse(req.body);
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
    if (!ticket) throw ApiError.notFound('Ticket');

    const isStaff = (SUPPORT_STAFF_ROLES as readonly string[]).includes(req.auth.role);
    if (!isStaff) {
      const customer = await prisma.customer.findFirst({ where: { userId: req.auth.userId } });
      if (!customer || ticket.customerId !== customer.id) {
        throw ApiError.forbidden('You can only reply to your own tickets', 'TICKET_NOT_OWNED');
      }
    }

    const msg = await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorUserId: req.auth.userId,
        body: b.body.trim(),
      },
    });

    if (isStaff && ticket.status === 'OPEN') {
      await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'IN_REVIEW' } });
    }

    const cust = await prisma.customer.findUnique({
      where: { id: ticket.customerId },
      include: { user: { select: { phone: true, email: true } } },
    });
    const target = cust?.user.phone || cust?.user.email || 'customer@bookcourier.local';
    await safeTicketNotify({
      shipmentId: ticket.shipmentId,
      channel: target.includes('@') ? 'EMAIL' : 'SMS',
      target,
      template: 'TICKET_REPLY',
      subject: `Update on Ticket: ${ticket.subject}`,
      message: `New reply on ticket "${ticket.subject}": ${b.body.trim().slice(0, 120)}`,
    });

    res.status(201).json(ok(msg));
  }),
);

/** PATCH /api/tickets/:id/status — staff resolves/closes ticket, optional refund claim payout */
const statusUpdateSchema = z.object({
  status: z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED']),
  resolutionNote: z.string().optional(),
  issueRefundAmount: z.number().positive().optional(),
});

ticketsRouter.patch(
  '/:id/status',
  requireAuth,
  requireRole(...SUPPORT_STAFF_ROLES),
  handler(async (req, res) => {
    const b = statusUpdateSchema.parse(req.body);
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
    if (!ticket) throw ApiError.notFound('Ticket');

    let refundResult: { refunded: boolean; refundId: string; amount: number } | undefined;
    if (b.issueRefundAmount && b.issueRefundAmount > 0) {
      if (!ticket.shipmentId) {
        throw ApiError.badRequest('SHIPMENT_REQUIRED', 'Cannot issue refund without a linked shipment');
      }
      const { refundPayment } = await import('../lib/payment/gateway');
      refundResult = await refundPayment(
        ticket.shipmentId,
        b.issueRefundAmount,
        `Claim refund (Ticket ${ticket.id.slice(0, 8)}): ${b.resolutionNote ?? ticket.subject}`,
      );
    }

    if (b.resolutionNote?.trim()) {
      await prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          authorUserId: req.auth.userId,
          body: `[Status -> ${b.status}] ${b.resolutionNote.trim()}${
            refundResult ? ` (Refund ₹${refundResult.amount} issued)` : ''
          }`,
        },
      });
    }

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: b.status },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'ticket.status_update',
        entity: 'Ticket',
        entityId: ticket.id,
        before: { status: ticket.status },
        after: { status: b.status, refund: refundResult?.amount ?? null },
      },
    });

    const cust = await prisma.customer.findUnique({
      where: { id: ticket.customerId },
      include: { user: { select: { phone: true, email: true } } },
    });
    const target = cust?.user.phone || cust?.user.email || 'customer@bookcourier.local';
    await safeTicketNotify({
      shipmentId: ticket.shipmentId,
      channel: target.includes('@') ? 'EMAIL' : 'SMS',
      target,
      template: 'TICKET_RESOLVED',
      subject: `Ticket ${b.status}: ${ticket.subject}`,
      message: `Your support ticket "${ticket.subject}" is now ${b.status}.${b.resolutionNote ? ` Note: ${b.resolutionNote}` : ''}`,
    });

    res.json(ok({ ticket: updated, refund: refundResult ?? null }));
  }),
);

