import { CarrierType, Prisma, ShipmentStatus } from '@prisma/client';
import { prisma } from './prisma';

export interface ReportFilter {
  from?: Date;
  to?: Date;
  carrierType?: CarrierType;
  status?: ShipmentStatus;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function buildAnalyticsReport(filter: ReportFilter = {}) {
  const where: Prisma.ShipmentWhereInput = {};
  if (filter.from || filter.to) {
    where.createdAt = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
  }
  if (filter.status) where.status = filter.status;
  if (filter.carrierType) {
    where.legs = { some: { carrierType: filter.carrierType } };
  }

  const [shipments, tasks, agents, cities, tickets, damageEvents] = await Promise.all([
    prisma.shipment.findMany({
      where,
      include: {
        legs: { orderBy: { sequence: 'asc' } },
        financial: true,
        events: {
          where: { status: 'DELIVERY_FAILED' },
          select: { id: true },
        },
        order: { select: { orderNo: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.task.findMany({
      where:
        filter.from || filter.to
          ? {
              createdAt: {
                ...(filter.from ? { gte: filter.from } : {}),
                ...(filter.to ? { lte: filter.to } : {}),
              },
            }
          : undefined,
    }),
    prisma.agent.findMany({
      include: { user: { select: { name: true } } },
    }),
    prisma.city.findMany(),
    prisma.ticket.findMany({
      select: { id: true, status: true, type: true, shipmentId: true },
    }),
    prisma.trackingEvent.findMany({
      where: { exceptionCode: { in: ['DAMAGED', 'WET_OR_TAMPERED'] } },
      select: { shipmentId: true },
    }),
  ]);

  const totalShipments = shipments.length;
  const delivered = shipments.filter((s) => s.status === 'DELIVERED');
  const deliveredCount = delivered.length;
  const inTransitCount = shipments.filter((s) =>
    ['PICKED_UP', 'AT_ORIGIN_HUB', 'IN_TRANSIT', 'AT_DESTINATION_HUB', 'OUT_FOR_DELIVERY'].includes(s.status),
  ).length;
  const rtoCount = shipments.filter((s) =>
    ['RTO_INITIATED', 'RTO_IN_TRANSIT', 'RTO_DELIVERED'].includes(s.status),
  ).length;
  const failedDeliveryCount = shipments.filter((s) => s.status === 'DELIVERY_FAILED').length;
  const cancelledCount = shipments.filter((s) => s.status === 'CANCELLED').length;
  const lostCount = shipments.filter((s) => s.status === 'LOST').length;

  // On-time delivery %
  const deliveredWithEta = delivered.filter((s) => s.estimatedDeliveryAt != null);
  const onTimeCount = deliveredWithEta.filter(
    (s) => s.statusUpdatedAt.getTime() <= s.estimatedDeliveryAt!.getTime(),
  ).length;
  const onTimeDeliveryPct =
    deliveredWithEta.length > 0 ? round1((onTimeCount / deliveredWithEta.length) * 100) : 100;

  // First-attempt delivery %
  const firstAttemptCount = delivered.filter((s) => s.events.length === 0).length;
  const firstAttemptDeliveryPct =
    deliveredCount > 0 ? round1((firstAttemptCount / deliveredCount) * 100) : 100;

  // Pickup success %
  const resolvedPickups = tasks.filter((t) => t.type === 'PICKUP' && (t.status === 'COMPLETED' || t.status === 'FAILED'));
  const completedPickups = resolvedPickups.filter((t) => t.status === 'COMPLETED').length;
  const pickupSuccessPct =
    resolvedPickups.length > 0 ? round1((completedPickups / resolvedPickups.length) * 100) : 100;

  // RTO Rate %
  const activeVolume = Math.max(1, totalShipments - cancelledCount);
  const rtoRatePct = totalShipments > 0 ? round1((rtoCount / activeVolume) * 100) : 0;

  // Damage / Loss rate %
  const damagedShipIds = new Set([
    ...shipments.filter((s) => s.status === 'LOST').map((s) => s.id),
    ...damageEvents.map((e) => e.shipmentId),
    ...tickets.filter((t) => t.type === 'DAMAGE' && t.shipmentId).map((t) => t.shipmentId!),
  ]);
  const scopedShipIds = new Set(shipments.map((s) => s.id));
  const damageLossCount = Array.from(damagedShipIds).filter((id) => scopedShipIds.has(id)).length;
  const damageLossRatePct = totalShipments > 0 ? round1((damageLossCount / totalShipments) * 100) : 0;

  // Financials (PAID shipments only for gross revenue)
  const paidShipments = shipments.filter((s) => s.paymentStatus === 'PAID');
  const grossRevenue = paidShipments.reduce((sum, s) => sum + Number(s.financial?.customerPrice ?? 0), 0);
  const totalTax = paidShipments.reduce((sum, s) => sum + Number(s.financial?.tax ?? 0), 0);
  const partnerCost = paidShipments.reduce((sum, s) => sum + Number(s.financial?.partnerCost ?? 0), 0);
  const ownCost = paidShipments.reduce((sum, s) => sum + Number(s.financial?.ownCost ?? 0), 0);
  const totalRefunded = shipments.reduce((sum, s) => sum + Number(s.financial?.refunded ?? 0), 0);
  const netMargin = grossRevenue - totalTax - partnerCost - ownCost - totalRefunded;

  // Status distribution
  const statusMap = new Map<string, number>();
  for (const s of shipments) {
    statusMap.set(s.status, (statusMap.get(s.status) ?? 0) + 1);
  }
  const statusDistribution = Array.from(statusMap.entries())
    .map(([status, count]) => ({
      status,
      count,
      pct: totalShipments > 0 ? round1((count / totalShipments) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Carrier performance (OWN vs PARTNER)
  const carrierBuckets: Record<'OWN' | 'PARTNER', { count: number; delivered: number; troubled: number; revenue: number; cost: number }> = {
    OWN: { count: 0, delivered: 0, troubled: 0, revenue: 0, cost: 0 },
    PARTNER: { count: 0, delivered: 0, troubled: 0, revenue: 0, cost: 0 },
  };
  for (const s of shipments) {
    const mode: 'OWN' | 'PARTNER' = s.legs.some((l) => l.carrierType === 'PARTNER') ? 'PARTNER' : 'OWN';
    const b = carrierBuckets[mode];
    b.count += 1;
    if (s.status === 'DELIVERED') b.delivered += 1;
    if (['DELIVERY_FAILED', 'PICKUP_FAILED', 'RTO_INITIATED', 'LOST'].includes(s.status)) b.troubled += 1;
    if (s.paymentStatus === 'PAID') {
      b.revenue += Number(s.financial?.customerPrice ?? 0) - Number(s.financial?.tax ?? 0);
      b.cost += Number(s.financial?.partnerCost ?? 0) + Number(s.financial?.ownCost ?? 0) + Number(s.financial?.refunded ?? 0);
    }
  }
  const carrierPerformance = (['OWN', 'PARTNER'] as const).map((mode) => {
    const b = carrierBuckets[mode];
    return {
      carrierType: mode,
      shipmentCount: b.count,
      deliveredCount: b.delivered,
      troubledCount: b.troubled,
      revenue: round2(b.revenue),
      cost: round2(b.cost),
      margin: round2(b.revenue - b.cost),
    };
  });

  // Agent Productivity
  const cityMap = new Map(cities.map((c) => [c.id, c.name]));
  const agentProductivity = agents.map((a) => {
    const aTasks = tasks.filter((t) => t.agentId === a.id);
    const pickupsCompleted = aTasks.filter((t) => t.type === 'PICKUP' && t.status === 'COMPLETED').length;
    const deliveriesCompleted = aTasks.filter((t) => t.type === 'DELIVERY' && t.status === 'COMPLETED').length;
    const failedTasks = aTasks.filter((t) => t.status === 'FAILED').length;
    return {
      agentId: a.id,
      name: a.user.name,
      cityName: cityMap.get(a.cityId) ?? a.cityId,
      isOnline: a.isOnline,
      pickupsCompleted,
      deliveriesCompleted,
      failedTasks,
      totalCompleted: pickupsCompleted + deliveriesCompleted,
    };
  });

  // Support stats
  const openTickets = tickets.filter((t) => t.status === 'OPEN' || t.status === 'IN_REVIEW').length;
  const resolvedTickets = tickets.filter((t) => t.status === 'RESOLVED' || t.status === 'CLOSED').length;

  return {
    summary: {
      totalShipments,
      deliveredCount,
      inTransitCount,
      rtoCount,
      failedDeliveryCount,
      cancelledCount,
      lostCount,
      onTimeDeliveryPct,
      firstAttemptDeliveryPct,
      pickupSuccessPct,
      rtoRatePct,
      damageLossCount,
      damageLossRatePct,
    },
    financials: {
      paidShipmentCount: paidShipments.length,
      grossRevenue: round2(grossRevenue),
      totalTax: round2(totalTax),
      partnerCost: round2(partnerCost),
      ownCost: round2(ownCost),
      totalRefunded: round2(totalRefunded),
      netMargin: round2(netMargin),
    },
    statusDistribution,
    carrierPerformance,
    agentProductivity,
    supportMetrics: {
      totalTickets: tickets.length,
      openTickets,
      resolvedTickets,
    },
  };
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function exportShipmentsCsv(filter: ReportFilter = {}): Promise<string> {
  const where: Prisma.ShipmentWhereInput = {};
  if (filter.from || filter.to) {
    where.createdAt = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
  }
  if (filter.status) where.status = filter.status;
  if (filter.carrierType) {
    where.legs = { some: { carrierType: filter.carrierType } };
  }

  const shipments = await prisma.shipment.findMany({
    where,
    include: {
      legs: { orderBy: { sequence: 'asc' } },
      financial: true,
      order: { select: { orderNo: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  });

  const headers = [
    'AWB',
    'CreatedAt',
    'ServiceType',
    'CarrierMode',
    'ShipmentType',
    'Status',
    'PaymentStatus',
    'CustomerPrice',
    'Tax',
    'PartnerCost',
    'Refunded',
    'NetMargin',
    'OrderNo',
  ];

  const rows = shipments.map((s) => {
    const mode = s.legs.some((l) => l.carrierType === 'PARTNER') ? 'PARTNER' : 'OWN';
    const price = Number(s.financial?.customerPrice ?? 0);
    const tax = Number(s.financial?.tax ?? 0);
    const pCost = Number(s.financial?.partnerCost ?? 0);
    const refunded = Number(s.financial?.refunded ?? 0);
    const margin = s.paymentStatus === 'PAID' ? round2(price - tax - pCost - refunded) : 0;

    return [
      s.awb,
      s.createdAt.toISOString(),
      s.serviceType,
      mode,
      s.shipmentType,
      s.status,
      s.paymentStatus,
      price.toFixed(2),
      tax.toFixed(2),
      pCost.toFixed(2),
      refunded.toFixed(2),
      margin.toFixed(2),
      s.order?.orderNo ?? '',
    ]
      .map(csvCell)
      .join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

