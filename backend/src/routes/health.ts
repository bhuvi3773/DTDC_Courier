import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ok, handler } from '../lib/errors';

export const healthRouter = Router();

healthRouter.get(
  '/',
  handler(async (_req, res) => {
    res.status(200).json(ok({ status: 'ok', uptime: process.uptime() }));
  }),
);

healthRouter.get(
  '/db',
  handler(async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json(ok({ db: 'up' }));
    } catch (e) {
      res.status(503).json({ statusCode: 503, code: 'DB_DOWN', message: String((e as Error).message) });
    }
  }),
);
