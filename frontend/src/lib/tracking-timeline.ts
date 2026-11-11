export interface MilestoneStep {
  key: string;
  label: string;
}

export const MILESTONES: MilestoneStep[] = [
  { key: 'BOOKED', label: 'Booked' },
  { key: 'PICKED_UP', label: 'Picked Up' },
  { key: 'AT_ORIGIN_HUB', label: 'Origin Hub' },
  { key: 'IN_TRANSIT', label: 'In Transit' },
  { key: 'AT_DESTINATION_HUB', label: 'Dest Hub' },
  { key: 'OUT_FOR_DELIVERY', label: 'Out for Delivery' },
  { key: 'DELIVERED', label: 'Delivered' },
];

export const RTO_MILESTONES: MilestoneStep[] = [
  { key: 'RTO_INITIATED', label: 'RTO Initiated' },
  { key: 'RTO_IN_TRANSIT', label: 'RTO In Transit' },
  { key: 'RTO_DELIVERED', label: 'RTO Delivered' },
];

export function computeMilestoneIndex(status: string): number {
  const s = status.toUpperCase();
  if (s === 'DELIVERED') return 6;
  if (s === 'OUT_FOR_DELIVERY' || s === 'DELIVERY_FAILED') return 5;
  if (s === 'AT_DESTINATION_HUB') return 4;
  if (s === 'IN_TRANSIT') return 3;
  if (s === 'AT_ORIGIN_HUB') return 2;
  if (s === 'PICKED_UP') return 1;
  return 0;
}

export function computeRtoMilestoneIndex(status: string): number {
  const s = status.toUpperCase();
  if (s === 'RTO_DELIVERED') return 2;
  if (s === 'RTO_IN_TRANSIT') return 1;
  return 0;
}

/** Sort public timeline entries newest-first so index 0 is always the latest update. */
export function orderTimelineNewestFirst<T extends { eventTime: string }>(entries: T[]): T[] {
  return entries
    .map((entry, index) => {
      const ms = new Date(entry.eventTime).getTime();
      return {
        entry,
        index,
        ms: Number.isFinite(ms) ? ms : 0,
      };
    })
    .sort((a, b) => b.ms - a.ms || b.index - a.index)
    .map((item) => item.entry);
}

