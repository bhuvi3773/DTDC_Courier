import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config, validateProductionSecrets } from './config';
import { requestContext, apiRateLimiter, authRateLimiter, publicRateLimiter } from './middleware/security';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { serviceabilityRouter } from './routes/serviceability';
import { pricingRouter } from './routes/pricing';
import { shipmentsRouter } from './routes/shipments';
import { trackingRouter } from './routes/tracking';
import { adminRouter } from './routes/admin';
import { webhooksRouter } from './routes/webhooks';
import { paymentsRouter, razorpayWebhook } from './routes/payments';
import { agentRouter } from './routes/agent';
import { tasksRouter } from './routes/tasks';
import { hubsRouter, manifestsRouter } from './routes/hubs';
import { addressesRouter } from './routes/addresses';
import { notificationsRouter } from './routes/notifications';
import { exceptionsRouter } from './routes/exceptions';
import { ticketsRouter } from './routes/tickets';
import { reportsRouter } from './routes/reports';
import { promosRouter } from './routes/promos';
import { b2bRouter } from './routes/b2b';
import { inquiriesRouter } from './routes/inquiries';
import { ApiError, fail } from './lib/errors';

const app = express();

app.set('trust proxy', 1);
app.use(requestContext);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(
  cors({
    origin: config.corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
    exposedHeaders: ['Content-Disposition', 'X-Request-Id'],
  }),
);

// Razorpay webhook needs the RAW body for HMAC-SHA512 signature verification,
// so it is mounted before the JSON parser (which would consume the stream).
app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json' }), razorpayWebhook);

app.use(express.json({ limit: '1mb' }));

// --- API routes (section 7: base path /api, JSON only). ---
app.use('/api', apiRateLimiter);
app.use('/api/health', healthRouter);
app.use('/api/auth', authRateLimiter, authRouter);
app.use('/api/serviceability', publicRateLimiter, serviceabilityRouter);
app.use('/api/pricing', pricingRouter);
app.use('/api/shipments', shipmentsRouter);
app.use('/api/track', publicRateLimiter);
app.use('/api', trackingRouter); // /track/:awb, /shipments/:id/tracking, /admin/shipments/:id/events
app.use('/api/admin', adminRouter); // /admin/carriers, /admin/dashboard, /admin/settings/routing-strategy
app.use('/api/webhooks', webhooksRouter); // /webhooks/:carrierCode, /webhooks/dev/:code/:awb/advance
app.use('/api/payments', paymentsRouter); // /payments/:id/confirm, /payments/shipment/:id
app.use('/api/agent', agentRouter); // Phase 5/6: agent tasks, scan, pickup, delivery
app.use('/api/tasks', tasksRouter); // Phase 5: task creation, assignment, auto-assign
app.use('/api/hubs', hubsRouter); // Phase 6: hub scan-in/out, inventory, vehicles
app.use('/api/manifests', manifestsRouter); // Phase 6: dispatch manifests & close -> IN_TRANSIT
app.use('/api/addresses', addressesRouter); // Phase 4: saved customer addresses CRUD
app.use('/api/notifications', notificationsRouter); // Phase 8: SMS/email notification logs & retries
app.use('/api/exceptions', exceptionsRouter); // Phase 8: flagged tracking events & operational exceptions
app.use('/api/tickets', ticketsRouter); // Phase 8: customer complaints, claims & support inbox
app.use('/api/reports', reportsRouter); // Phase 9: KPI analytics, finance ledger & CSV exports
app.use('/api/promos', promosRouter); // Promos & discount coupons
app.use('/api/b2b', b2bRouter); // Corporate B2B, Bulk CSV & ONDC/Partner API keys
app.use('/api/inquiries', inquiriesRouter); // 3PL, FTL, Cold-chain & Franchise partner onboarding

// --- 404 for unknown API paths. ---
app.use((req: any, res: any) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json(fail(404, 'NOT_FOUND', 'Not found'));
  }
  res.status(404).send('Not found');
});

// --- Central error handler -> canonical envelope. ---
app.use((err: unknown, req: any, res: any, _next: any) => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json(fail(err.statusCode, err.code, err.message, err.details));
    return;
  }
  // Zod errors.
  if (err && typeof err === 'object' && 'issues' in err) {
    res.status(400).json(fail(400, 'VALIDATION_ERROR', 'Invalid request body', (err as any).issues));
    return;
  }
  console.error('[unhandled]', err);
  res.status(500).json(fail(500, 'INTERNAL', 'Internal server error'));
});

const isTestEnv =
  process.env.NODE_ENV === 'test' || process.argv.some((arg) => arg.includes('--test'));

if (require.main === module && !isTestEnv) {
  const warnings = validateProductionSecrets();
  if (warnings.length > 0 && config.nodeEnv !== 'development') {
    console.warn('[security] Secret configuration warnings:', warnings.join('; '));
  }
  app.listen(config.port, () => {
    console.log(`book-courier-backend listening on http://localhost:${config.port}`);
    console.log(`CORS origin: ${config.corsOrigin}`);
  });
}

export { app };
export default app;
