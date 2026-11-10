import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ok, handler, ApiError } from '../lib/errors';
import { requireAuth } from '../lib/auth';

export const addressesRouter = Router();

const addressSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(5),
  line1: z.string().min(2),
  line2: z.string().optional(),
  landmark: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().min(5),
});

/** GET /api/addresses — list saved addresses for the logged-in user */
addressesRouter.get(
  '/',
  requireAuth,
  handler(async (req, res) => {
    const customer = await prisma.customer.findFirst({ where: { userId: req.auth.userId } });
    if (!customer) {
      res.json(ok([]));
      return;
    }
    const list = await prisma.address.findMany({
      where: { customerId: customer.id, isSaved: true },
      orderBy: { name: 'asc' },
    });
    res.json(ok(list));
  }),
);

/** POST /api/addresses — save a new address to the customer's address book */
addressesRouter.post(
  '/',
  requireAuth,
  handler(async (req, res) => {
    const b = addressSchema.parse(req.body);
    let customer = await prisma.customer.findFirst({ where: { userId: req.auth.userId } });
    if (!customer) {
      customer = await prisma.customer.create({
        data: { userId: req.auth.userId, type: 'INDIVIDUAL' },
      });
    }
    const saved = await prisma.address.create({
      data: {
        customerId: customer.id,
        name: b.name,
        phone: b.phone,
        line1: b.line1,
        line2: b.line2 ?? null,
        landmark: b.landmark ?? null,
        city: b.city,
        state: b.state,
        pincode: b.pincode,
        isSaved: true,
      },
    });
    res.status(201).json(ok(saved));
  }),
);

/** DELETE /api/addresses/:id — remove a saved address */
addressesRouter.delete(
  '/:id',
  requireAuth,
  handler(async (req, res) => {
    const customer = await prisma.customer.findFirst({ where: { userId: req.auth.userId } });
    if (!customer) throw ApiError.notFound('Address');

    const addr = await prisma.address.findUnique({ where: { id: req.params.id } });
    if (!addr || addr.customerId !== customer.id || !addr.isSaved) {
      throw ApiError.notFound('Saved address');
    }

    await prisma.address.delete({ where: { id: addr.id } });
    res.json(ok({ deleted: addr.id }));
  }),
);
