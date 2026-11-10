import crypto from 'crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { fail } from '../lib/errors';

const SAFE_REQUEST_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Propagate or assign an `X-Request-Id` header and log non-sensitive HTTP
 * request telemetry (never logs headers, OTPs, passwords, or request bodies).
 */
export const requestContext: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const incoming = req.header('x-request-id');
  const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
  (req as Request & { requestId?: string }).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test' && process.env.LOG_HTTP !== '1') return;
    const ms = Date.now() - startedAt;
    const cleanPath = req.originalUrl.split('?')[0];
    console.log(`[http] ${req.method} ${cleanPath} ${res.statusCode} ${ms}ms reqId=${requestId}`);
  });

  next();
};

function envLimit(envKey: string, prodDefault: number, devDefault: number): number {
  const raw = process.env[envKey];
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return process.env.NODE_ENV === 'production' ? prodDefault : devDefault;
}

/** Build a JSON-enveloped rate limiter with dynamic limits and standard RateLimit-* headers. */
export function createRateLimiter(opts: {
  windowMs: number;
  limit: () => number;
  message: string;
  skip?: (req: Request) => boolean;
}): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: () => opts.limit(),
    standardHeaders: true,
    legacyHeaders: false,
    skip: opts.skip,
    handler: (_req, res) => {
      res.status(429).json(fail(429, 'RATE_LIMITED', opts.message));
    },
  });
}

/** Brute-force protection on authentication mutations (OTP / login / register). */
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: () => envLimit('RATE_LIMIT_AUTH_MAX', 30, 300),
  message: 'Too many authentication attempts, please wait and try again.',
  skip: (req) => req.method === 'GET',
});

/** Rate limiter for unauthenticated public tracking and pincode serviceability endpoints. */
export const publicRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  limit: () => envLimit('RATE_LIMIT_PUBLIC_MAX', 60, 400),
  message: 'Too many public lookup requests, please slow down.',
});

/** Baseline per-IP API rate limiter across /api (skips signed carrier/payment webhooks). */
export const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  limit: () => envLimit('RATE_LIMIT_API_MAX', 240, 1200),
  message: 'Too many API requests, please try again shortly.',
  skip: (req) => req.path.startsWith('/webhooks'),
});

