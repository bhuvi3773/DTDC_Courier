/** Standard API error type. Every thrown domain error is turned into the
 *  canonical envelope `{ statusCode, code, message, details? }`. */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new ApiError(400, code, message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
    return new ApiError(403, code, message);
  }
  static notFound(entity = 'Resource') {
    return new ApiError(404, 'NOT_FOUND', `${entity} not found`);
  }
  static unprocessable(message: string, code = 'VALIDATION_ERROR', details?: unknown) {
    return new ApiError(422, code, message, details);
  }
}

/** Standard success envelope. */
export function ok<T>(data: T, meta?: Record<string, unknown>) {
  return meta ? { data, meta } : { data };
}

/** Standard error envelope. */
export function fail(statusCode: number, code: string, message: string, details?: unknown) {
  const body: Record<string, unknown> = { statusCode, code, message };
  if (details !== undefined) body.details = details;
  return body;
}

/** Wrap an async route handler so thrown errors reach the global handler. */
export function handler<T extends (...args: any[]) => Promise<any>>(fn: T) {
  return async (req: any, res: any, next: any) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}
