import { ServiceType } from '@prisma/client';
import { prisma } from './prisma';

/** Minimal slab price lookup used by the OWN adapter (separate from the full
 *  quote engine which adds fees, tax and contracts). */
export async function findSlabPrice(
  originZone: string,
  destZone: string,
  serviceType: ServiceType,
  weightKg: number,
): Promise<number> {
  const slab = await prisma.pricingRule.findFirst({
    where: {
      originZone,
      destZone,
      serviceType,
      isActive: true,
      maxWeightKg: { gte: weightKg },
    },
    orderBy: { maxWeightKg: 'asc' },
  });
  if (!slab) {
    const nearest = await prisma.pricingRule.findFirst({
      where: { originZone, destZone, serviceType, isActive: true },
      orderBy: { maxWeightKg: 'asc' },
    });
    if (!nearest) throw new Error(`No pricing rule for ${originZone}->${destZone} (${serviceType})`);
    return Number(nearest.price);
  }
  return Number(slab.price);
}
