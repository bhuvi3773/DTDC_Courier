import crypto from 'crypto';

/** Constant-time string comparison helper for hex/signature digests. */
export function timingSafeEqualHex(expected: string, actual: string): boolean {
  if (!expected || !actual) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyRazorpayWebhook(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    // In dev mode when no webhook secret is configured, log warning and accept
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[webhook-verify] No RAZORPAY_WEBHOOK_SECRET configured; accepting in dev');
      return true;
    }
    return false;
  }

  const expected = crypto
    .createHmac('sha512', secret)
    .update(rawBody)
    .digest('hex');

  return timingSafeEqualHex(expected, signature);
}

