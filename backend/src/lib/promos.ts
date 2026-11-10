import { prisma } from './prisma';
import { round2 } from './pricing';

export interface PromoValidationResult {
  valid: boolean;
  code: string;
  discountAmount: number;
  description?: string;
  reason?: string;
}

/**
 * Validate a promo code against a given taxable subtotal and compute discount.
 */
export async function validatePromoCode(
  rawCode: string | undefined | null,
  subtotalAmount: number,
): Promise<PromoValidationResult | null> {
  if (!rawCode || !rawCode.trim()) return null;
  const code = rawCode.trim().toUpperCase();
  const promo = await prisma.promoCode.findUnique({ where: { code } });

  if (!promo || !promo.isActive) {
    return { valid: false, code, discountAmount: 0, reason: `Promo code "${code}" is invalid or inactive` };
  }
  if (promo.validUntil && promo.validUntil.getTime() < Date.now()) {
    return { valid: false, code, discountAmount: 0, reason: `Promo code "${code}" has expired` };
  }
  if (promo.usageLimit != null && promo.usedCount >= promo.usageLimit) {
    return { valid: false, code, discountAmount: 0, reason: `Promo code "${code}" usage limit reached` };
  }
  const minOrder = Number(promo.minOrderAmount ?? 0);
  if (subtotalAmount < minOrder) {
    return {
      valid: false,
      code,
      discountAmount: 0,
      reason: `Promo "${code}" requires a minimum order of ₹${minOrder}`,
    };
  }

  let discount =
    promo.discountType === 'PERCENT'
      ? (subtotalAmount * Number(promo.discountValue)) / 100
      : Number(promo.discountValue);

  if (promo.maxDiscount != null) {
    discount = Math.min(discount, Number(promo.maxDiscount));
  }
  discount = Math.min(discount, Math.max(0, subtotalAmount - 10));
  return {
    valid: true,
    code: promo.code,
    discountAmount: round2(Math.max(0, discount)),
    description: promo.description,
  };
}

