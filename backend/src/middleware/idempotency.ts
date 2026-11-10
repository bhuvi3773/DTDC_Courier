import { RequestHandler } from 'express';
import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';

/**
 * Idempotency-Key support (plan §7): mutating endpoints accept an
 * `Idempotency-Key` header. First call executes and stores the response
 * (scoped to key + user); a repeat call with the same key returns the stored
 * response without re-running the handler. This makes agent sync, payment
 * confirmation, and webhook-driven mutations safe against duplicates.
 */
export function idempotent(scope: string, opts?: { required?: boolean }): RequestHandler {
  return (req, res, next) => {
    const keyHeader = req.header('Idempotency-Key');
    if (!keyHeader) {
      if (opts?.required) {
        next(ApiError.badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required'));
        return;
      }
      next();
      return;
    }

    const compositeKey = `${scope}:${(req as any).auth?.userId ?? 'anon'}:${keyHeader}`;

    prisma.idempotencyKey
      .findUnique({ where: { key: compositeKey } })
      .then((rec) => {
        if (rec) {
          // Replay the stored response; do NOT re-run the handler.
          res.status(rec.statusCode).json(rec.responseJson);
          return;
        }
        // First call: capture the JSON response and persist it.
        const originalJson = res.json.bind(res);
        res.json = (body: unknown) => {
          prisma.idempotencyKey
            .create({
              data: {
                key: compositeKey,
                scope,
                userId: (req as any).auth?.userId ?? null,
                requestBody: (req.body ?? {}) as object,
                responseJson: body as object,
                statusCode: res.statusCode,
              },
            })
            .catch((e) => console.error('[idempotency] failed to store', e));
          return originalJson(body);
        };
        next();
      })
      .catch(next);
  };
}
