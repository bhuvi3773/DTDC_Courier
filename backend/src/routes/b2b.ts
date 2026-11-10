import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ok, handler, ApiError } from '../lib/errors';
import { requireAuth, requireRole } from '../lib/auth';
import { getRoutingOptions } from '../lib/carriers/carrier-router';
import { createShipment } from '../lib/shipments';
import { SERVICE_TYPE_VALUES, PACKAGING_VALUES, resolveCallerContractRule } from './pricing';

export const b2bRouter = Router();

/** GET /api/b2b/profile — corporate account, active contract & API keys */
b2bRouter.get(
  '/profile',
  requireAuth,
  handler(async (req, res) => {
    const customer = await prisma.customer.findFirst({
      where: { userId: req.auth.userId },
      include: {
        businessAccount: {
          include: {
            contracts: { orderBy: { validFrom: 'desc' }, take: 5 },
          },
        },
      },
    });
    const keys = await prisma.partnerApiKey.findMany({
      where: { userId: req.auth.userId },
      select: {
        id: true,
        label: true,
        keyPrefix: true,
        webhookUrl: true,
        ondcSubscriberId: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const acc = customer?.businessAccount;
    res.json(
      ok({
        customerType: customer?.type ?? 'INDIVIDUAL',
        businessAccount: acc
          ? {
              ...acc,
              creditLimit: acc.creditLimit != null ? Number(acc.creditLimit) : 0,
            }
          : null,
        apiKeys: keys,
      }),
    );
  }),
);

/** POST /api/b2b/account — apply/register a B2B corporate account */
const accountSchema = z.object({
  legalName: z.string().trim().min(2),
  gstin: z.string().trim().min(10).max(20).optional(),
  requestedCreditLimit: z.number().nonnegative().optional(),
});

b2bRouter.post(
  '/account',
  requireAuth,
  handler(async (req, res) => {
    const b = accountSchema.parse(req.body);
    let customer = await prisma.customer.findFirst({ where: { userId: req.auth.userId } });
    if (!customer) {
      customer = await prisma.customer.create({
        data: { userId: req.auth.userId, type: 'BUSINESS' },
      });
    }

    if (customer.businessAccountId) {
      const updated = await prisma.businessAccount.update({
        where: { id: customer.businessAccountId },
        data: { legalName: b.legalName, gstin: b.gstin ?? null },
      });
      return res.json(ok({ ...updated, creditLimit: Number(updated.creditLimit ?? 0) }));
    }

    const account = await prisma.businessAccount.create({
      data: {
        legalName: b.legalName,
        gstin: b.gstin ?? null,
        creditLimit: b.requestedCreditLimit ?? 25000,
        isApproved: false,
      },
    });
    await prisma.customer.update({
      where: { id: customer.id },
      data: { type: 'BUSINESS', businessAccountId: account.id },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'b2b.account_apply',
        entity: 'BusinessAccount',
        entityId: account.id,
        after: { legalName: account.legalName, gstin: account.gstin },
      },
    });

    res.status(201).json(ok({ ...account, creditLimit: Number(account.creditLimit ?? 0) }));
  }),
);

const bulkRowSchema = z.object({
  fromPincode: z.string().min(4),
  toPincode: z.string().min(3),
  recipientName: z.string().min(2),
  recipientPhone: z.string().min(5),
  recipientLine1: z.string().min(3),
  recipientCity: z.string().min(2),
  recipientState: z.string().min(2),
  weightKg: z.number().positive(),
  serviceType: z.enum(SERVICE_TYPE_VALUES).default('INTERCITY'),
  packaging: z.enum(PACKAGING_VALUES).default('CUSTOMER_PACKED'),
  fulfillmentMode: z.enum(['OWN', 'PARTNER']).default('OWN'),
  paymentMethod: z.enum(['PREPAID', 'COD', 'CORPORATE_CREDIT']).default('PREPAID'),
  goodsDescription: z.string().optional(),
  destinationCountry: z.string().max(4).default('IN'),
});

/** POST /api/b2b/bulk-quote — quote up to 50 CSV/batch rows */
b2bRouter.post(
  '/bulk-quote',
  requireAuth,
  handler(async (req, res) => {
    const { rows } = z.object({ rows: z.array(bulkRowSchema).min(1).max(50) }).parse(req.body);
    const contractRule = await resolveCallerContractRule(req.auth.userId);

    const results = await Promise.all(
      rows.map(async (row, idx) => {
        try {
          const opts = await getRoutingOptions({
            fromPincode: row.fromPincode,
            toPincode: row.toPincode,
            serviceType: row.serviceType,
            packaging: row.packaging,
            dims: { lengthCm: 28, widthCm: 20, heightCm: 10, actualWeightKg: row.weightKg },
            paymentMethod: row.paymentMethod,
            destinationCountry: row.destinationCountry,
            fulfillmentMode: row.fulfillmentMode,
            ownOnly: row.fulfillmentMode === 'OWN',
            businessContractRule: contractRule,
          });
          const best = opts[0];
          if (!best) {
            return { index: idx, ok: false, error: `No serviceable route for ${row.fromPincode} -> ${row.toPincode}` };
          }
          return {
            index: idx,
            ok: true,
            optionId: best.optionId,
            carrierCodes: best.carrierCodes,
            price: best.price,
            etaDays: best.etaDays,
          };
        } catch (err: any) {
          return { index: idx, ok: false, error: err?.message ?? 'Quote failed' };
        }
      }),
    );

    const totalAmount = results.reduce((sum, r) => sum + (r.ok && r.price ? r.price : 0), 0);
    res.json(ok({ results, totalAmount: Math.round(totalAmount * 100) / 100, hasCorporateRate: Boolean(contractRule) }));
  }),
);

/** POST /api/b2b/bulk-book — batch create up to 50 shipments from CSV rows */
b2bRouter.post(
  '/bulk-book',
  requireAuth,
  handler(async (req, res) => {
    const { pickupAddress, rows } = z
      .object({
        pickupAddress: z.object({
          name: z.string().min(2),
          phone: z.string().min(5),
          line1: z.string().min(3),
          city: z.string().min(2),
          state: z.string().min(2),
          pincode: z.string().min(4),
        }),
        rows: z.array(bulkRowSchema).min(1).max(50),
      })
      .parse(req.body);

    const customer = await prisma.customer.findFirst({ where: { userId: req.auth.userId } });
    if (!customer) throw ApiError.badRequest('NO_CUSTOMER_PROFILE', 'Customer profile required');
    const contractRule = await resolveCallerContractRule(req.auth.userId);

    const created: Array<{ index: number; awb: string; price: string; carrierMode: string }> = [];
    const failed: Array<{ index: number; recipientName: string; error: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const opts = await getRoutingOptions({
          fromPincode: r.fromPincode,
          toPincode: r.toPincode,
          serviceType: r.serviceType,
          packaging: r.packaging,
          dims: { lengthCm: 28, widthCm: 20, heightCm: 10, actualWeightKg: r.weightKg },
          paymentMethod: r.paymentMethod,
          destinationCountry: r.destinationCountry,
          fulfillmentMode: r.fulfillmentMode,
          ownOnly: r.fulfillmentMode === 'OWN',
          businessContractRule: contractRule,
        });
        const best = opts[0];
        if (!best) throw new Error(`Route not serviceable: ${r.fromPincode} -> ${r.toPincode}`);

        const resShip = await createShipment({
          customerId: customer.id,
          optionId: best.optionId,
          shipmentType: r.fulfillmentMode === 'PARTNER' ? 'PARTNER_DIRECT_SHIPMENT' : 'CUSTOMER_OWN_BOOK_SHIPMENT',
          fulfillmentMode: r.fulfillmentMode,
          serviceType: r.serviceType,
          packaging: r.packaging,
          bookCount: 1,
          parcelCount: 1,
          protectionOpted: false,
          paymentMethod: r.paymentMethod,
          destinationCountry: r.destinationCountry,
          solutionCategory: 'B2B_BULK_CSV',
          goodsDescription: r.goodsDescription ?? 'B2B Bulk Manifest Parcel',
          fromPincode: r.fromPincode,
          toPincode: r.toPincode,
          dims: { lengthCm: 28, widthCm: 20, heightCm: 10, actualWeightKg: r.weightKg },
          pickupAddress: { ...pickupAddress, pincode: r.fromPincode },
          deliveryAddress: {
            name: r.recipientName,
            phone: r.recipientPhone,
            line1: r.recipientLine1,
            city: r.recipientCity,
            state: r.recipientState,
            pincode: r.toPincode,
          },
          businessContractRule: contractRule,
        });
        created.push({
          index: i,
          awb: resShip.shipment!.awb,
          price: resShip.paymentOrder.amount,
          carrierMode: best.carrierCodes.join(','),
        });
      } catch (err: any) {
        failed.push({ index: i, recipientName: r.recipientName, error: err?.message ?? 'Row failed' });
      }
    }

    res.status(201).json(ok({ createdCount: created.length, failedCount: failed.length, created, failed }));
  }),
);

// ---------- E-Commerce & ONDC API Keys + Webhook Tester ----------
b2bRouter.post(
  '/api-keys',
  requireAuth,
  handler(async (req, res) => {
    const b = z
      .object({
        label: z.string().trim().min(2),
        webhookUrl: z.string().url().optional().or(z.literal('')),
        ondcSubscriberId: z.string().trim().optional(),
      })
      .parse(req.body);

    const customer = await prisma.customer.findFirst({ where: { userId: req.auth.userId } });
    const rawKey = `bc_live_${crypto.randomBytes(18).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const created = await prisma.partnerApiKey.create({
      data: {
        userId: req.auth.userId,
        businessAccountId: customer?.businessAccountId ?? null,
        label: b.label,
        keyPrefix: rawKey.slice(0, 14),
        keyHash,
        webhookUrl: b.webhookUrl || null,
        ondcSubscriberId: b.ondcSubscriberId || null,
      },
    });

    res.status(201).json(
      ok({
        id: created.id,
        label: created.label,
        keyPrefix: created.keyPrefix,
        plaintextKey: rawKey,
        webhookUrl: created.webhookUrl,
        ondcSubscriberId: created.ondcSubscriberId,
        createdAt: created.createdAt,
      }),
    );
  }),
);

b2bRouter.delete(
  '/api-keys/:id',
  requireAuth,
  handler(async (req, res) => {
    const existing = await prisma.partnerApiKey.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.auth.userId) {
      throw ApiError.notFound('PartnerApiKey');
    }
    await prisma.partnerApiKey.delete({ where: { id: existing.id } });
    res.json(ok({ deleted: existing.id }));
  }),
);

b2bRouter.post(
  '/api-keys/:id/test-webhook',
  requireAuth,
  handler(async (req, res) => {
    const keyRow = await prisma.partnerApiKey.findUnique({ where: { id: req.params.id } });
    if (!keyRow || keyRow.userId !== req.auth.userId) throw ApiError.notFound('PartnerApiKey');

    const eventPayload = {
      event: 'ondc.logistics.on_status',
      subscriberId: keyRow.ondcSubscriberId ?? 'bookcourier-ondc-bpp',
      awb: `BC${new Date().getFullYear().toString().slice(-2)}0000001`,
      status: 'OUT_FOR_DELIVERY',
      timestamp: new Date().toISOString(),
    };

    const sig = crypto.createHmac('sha256', keyRow.keyHash).update(JSON.stringify(eventPayload)).digest('hex');
    let delivered = false;
    let httpStatus: number | null = null;
    let detail = 'Simulated signed dispatch locally (configure HTTPS Webhook URL for live POST delivery)';

    if (keyRow.webhookUrl) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 4000);
        const r = await fetch(keyRow.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-BookCourier-Signature': sig },
          body: JSON.stringify(eventPayload),
          signal: controller.signal,
        });
        clearTimeout(t);
        httpStatus = r.status;
        delivered = r.ok;
        detail = `Remote endpoint responded HTTP ${r.status}`;
      } catch (e: any) {
        detail = `Remote fetch failed: ${e?.message ?? 'timeout/network'}`;
      }
    }

    await prisma.partnerApiKey.update({ where: { id: keyRow.id }, data: { lastUsedAt: new Date() } });
    res.json(ok({ delivered, httpStatus, detail, signature: sig, payload: eventPayload }));
  }),
);

// ---------- Admin B2B Management ----------
const B2B_ADMIN_ROLES = ['SUPER_ADMIN', 'FINANCE', 'OPS_MANAGER'] as const;

b2bRouter.get(
  '/admin/accounts',
  requireAuth,
  requireRole(...B2B_ADMIN_ROLES),
  handler(async (_req, res) => {
    const accounts = await prisma.businessAccount.findMany({
      include: {
        customers: { include: { user: { select: { name: true, email: true, phone: true } } } },
        contracts: { orderBy: { validFrom: 'desc' } },
      },
    });
    res.json(
      ok(
        accounts.map((a) => ({
          ...a,
          creditLimit: a.creditLimit != null ? Number(a.creditLimit) : 0,
        })),
      ),
    );
  }),
);

b2bRouter.patch(
  '/admin/accounts/:id',
  requireAuth,
  requireRole(...B2B_ADMIN_ROLES),
  handler(async (req, res) => {
    const b = z
      .object({
        isApproved: z.boolean().optional(),
        creditLimit: z.number().nonnegative().optional(),
        discountPct: z.number().min(0).max(50).optional(),
      })
      .parse(req.body);

    const updated = await prisma.businessAccount.update({
      where: { id: req.params.id },
      data: {
        ...(b.isApproved !== undefined ? { isApproved: b.isApproved } : {}),
        ...(b.creditLimit !== undefined ? { creditLimit: b.creditLimit } : {}),
      },
    });

    if (b.discountPct !== undefined) {
      const mult = Math.max(0.5, 1 - b.discountPct / 100);
      await prisma.businessContract.create({
        data: {
          businessAccountId: updated.id,
          ruleJson: { slabMultiplier: Number(mult.toFixed(2)), label: `${b.discountPct}% Negotiated Rate` },
          validFrom: new Date(),
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth.userId,
        action: 'b2b.account_update',
        entity: 'BusinessAccount',
        entityId: updated.id,
        after: b,
      },
    });

    res.json(ok({ ...updated, creditLimit: Number(updated.creditLimit ?? 0) }));
  }),
);

