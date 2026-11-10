import { Router } from 'express';
import { CarrierType, ShipmentStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ok, handler, ApiError } from '../lib/errors';
import { requireAuth, requireRole } from '../lib/auth';
import { buildAnalyticsReport, exportShipmentsCsv, ReportFilter } from '../lib/reports';

export const reportsRouter = Router();

const REPORT_ROLES = ['SUPER_ADMIN', 'OPS_MANAGER', 'CITY_MANAGER', 'HUB_MANAGER', 'FINANCE'] as const;

function parseFilter(query: any): ReportFilter {
  const f: ReportFilter = {};
  if (typeof query.from === 'string' && query.from) {
    const d = new Date(query.from);
    if (!Number.isNaN(d.getTime())) f.from = d;
  }
  if (typeof query.to === 'string' && query.to) {
    const d = new Date(query.to);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCHours(23, 59, 59, 999);
      f.to = d;
    }
  }
  if (query.carrierType === 'OWN' || query.carrierType === 'PARTNER') {
    f.carrierType = query.carrierType as CarrierType;
  }
  if (typeof query.status === 'string' && query.status) {
    f.status = query.status as ShipmentStatus;
  }
  return f;
}

/** GET /api/reports/analytics — KPIs, SLA rates, margin breakdown, carrier perf, agent productivity */
reportsRouter.get(
  '/analytics',
  requireAuth,
  requireRole(...REPORT_ROLES),
  handler(async (req, res) => {
    const data = await buildAnalyticsReport(parseFilter(req.query));
    res.json(ok(data));
  }),
);

/** GET /api/reports/finance — recent payments, refunds, and issued GST invoices */
reportsRouter.get(
  '/finance',
  requireAuth,
  requireRole('SUPER_ADMIN', 'FINANCE', 'OPS_MANAGER'),
  handler(async (_req, res) => {
    const [payments, refunds, invoices] = await Promise.all([
      prisma.payment.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.refund.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.invoice.findMany({
        orderBy: { issuedAt: 'desc' },
        take: 50,
      }),
    ]);

    const shipIds = Array.from(
      new Set([
        ...payments.map((p) => p.shipmentId),
        ...invoices.map((i) => i.shipmentId).filter(Boolean) as string[],
      ]),
    );
    const ships = shipIds.length
      ? await prisma.shipment.findMany({
          where: { id: { in: shipIds } },
          select: { id: true, awb: true, status: true, paymentStatus: true },
        })
      : [];
    const shipMap = new Map(ships.map((s) => [s.id, s]));

    res.json(
      ok({
        payments: payments.map((p) => ({
          ...p,
          amount: Number(p.amount),
          awb: shipMap.get(p.shipmentId)?.awb ?? null,
        })),
        refunds: refunds.map((r) => ({ ...r, amount: Number(r.amount) })),
        invoices: invoices.map((i) => ({
          ...i,
          total: Number(i.total),
          awb: i.shipmentId ? shipMap.get(i.shipmentId)?.awb ?? null : null,
        })),
      }),
    );
  }),
);

/** GET /api/reports/export/shipments.csv — RFC-4180 CSV ledger export */
reportsRouter.get(
  '/export/shipments.csv',
  requireAuth,
  requireRole(...REPORT_ROLES),
  handler(async (req, res) => {
    const csv = await exportShipmentsCsv(parseFilter(req.query));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bookcourier-shipments-report.csv"');
    res.send(csv);
  }),
);

/** GET /api/reports/cod — Cash on Delivery collection & remittance ledger */
reportsRouter.get(
  '/cod',
  requireAuth,
  requireRole('SUPER_ADMIN', 'FINANCE', 'OPS_MANAGER'),
  handler(async (_req, res) => {
    const shipments = await prisma.shipment.findMany({
      where: { paymentMethod: 'COD' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const rows = shipments.map((s) => ({
      id: s.id,
      awb: s.awb,
      status: s.status,
      codAmount: Number(s.codAmount ?? 0),
      codCollected: s.codCollected,
      codRemitted: s.codRemitted,
      paymentStatus: s.paymentStatus,
      createdAt: s.createdAt,
    }));
    const pendingCollection = rows.filter((r) => !r.codCollected && r.status !== 'CANCELLED').reduce((s, r) => s + r.codAmount, 0);
    const awaitingRemittance = rows.filter((r) => r.codCollected && !r.codRemitted).reduce((s, r) => s + r.codAmount, 0);
    const remittedTotal = rows.filter((r) => r.codRemitted).reduce((s, r) => s + r.codAmount, 0);
    res.json(
      ok({
        summary: {
          pendingCollection: Math.round(pendingCollection * 100) / 100,
          awaitingRemittance: Math.round(awaitingRemittance * 100) / 100,
          remittedTotal: Math.round(remittedTotal * 100) / 100,
        },
        shipments: rows,
      }),
    );
  }),
);

/** POST /api/reports/cod/:shipmentId/remit — mark collected COD cash settled/remitted */
reportsRouter.post(
  '/cod/:shipmentId/remit',
  requireAuth,
  requireRole('SUPER_ADMIN', 'FINANCE', 'OPS_MANAGER'),
  handler(async (req, res) => {
    const s = await prisma.shipment.findUnique({ where: { id: req.params.shipmentId } });
    if (!s || s.paymentMethod !== 'COD') throw ApiError.notFound('COD Shipment');
    if (!s.codCollected) {
      throw ApiError.unprocessable('Cash has not been marked collected at delivery yet', 'COD_NOT_COLLECTED');
    }
    const updated = await prisma.shipment.update({
      where: { id: s.id },
      data: { codRemitted: true },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'finance.cod_remit',
        entity: 'Shipment',
        entityId: s.id,
        after: { awb: s.awb, codAmount: Number(s.codAmount ?? 0), codRemitted: true },
      },
    });
    res.json(ok({ id: updated.id, awb: updated.awb, codRemitted: updated.codRemitted }));
  }),
);

