import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ceilToStep, volumetricWeightKg, chargeableWeightKg } from '../lib/pricing';
import { luhnCheckDigit, buildAwb } from '../lib/awb';
import { ALLOWED_TRANSITIONS, isTerminal, isBranch, rank } from '../lib/tracking';
import { config, validateProductionSecrets } from '../config';
import { computeMockSignature, verifyClientPayment } from '../lib/payment/gateway';
import { timingSafeEqualHex, verifyRazorpayWebhook } from '../lib/payment/webhook-verify';
import { normalizeEmail, validatePasswordStrength } from '../lib/auth';

test('Pricing math: volumetricWeightKg, ceilToStep, and chargeableWeightKg', () => {
  assert.equal(volumetricWeightKg({ lengthCm: 30, widthCm: 20, heightCm: 10, actualWeightKg: 1 }, 5000), 1.2);
  assert.equal(ceilToStep(1.2, 0.5), 1.5);
  assert.equal(ceilToStep(2.0, 0.5), 2.0);
  assert.equal(ceilToStep(2.01, 0.5), 2.5);

  // Volumetric wins (1.2 kg rounded up to 1.5 kg)
  assert.equal(
    chargeableWeightKg({ lengthCm: 30, widthCm: 20, heightCm: 10, actualWeightKg: 0.8 }, 5000, 0.5),
    1.5,
  );
  // Actual weight wins (2.2 kg rounded up to 2.5 kg)
  assert.equal(
    chargeableWeightKg({ lengthCm: 20, widthCm: 15, heightCm: 5, actualWeightKg: 2.2 }, 5000, 0.5),
    2.5,
  );
});

test('AWB generation: format BC+YYMM+6seq+Luhn and check digit determinism', () => {
  const awb1 = buildAwb('2611', 1);
  const awb2 = buildAwb('2611', 2);
  assert.match(awb1, /^BC2611\d{7}$/);
  assert.match(awb2, /^BC2611\d{7}$/);
  assert.notEqual(awb1, awb2);

  // Check digit reproduces luhnCheckDigit over numeric portion
  const numericBody = '2611000042';
  const expectedDigit = luhnCheckDigit(numericBody);
  assert.equal(buildAwb('2611', 42), `BC${numericBody}${expectedDigit}`);
});

test('Tracking state machine: transitions, terminal, branch, and partner rank ordering', () => {
  assert.ok(ALLOWED_TRANSITIONS.BOOKED.includes('PICKUP_SCHEDULED'));
  assert.ok(ALLOWED_TRANSITIONS.BOOKED.includes('CANCELLED'));
  assert.ok(!ALLOWED_TRANSITIONS.BOOKED.includes('DELIVERED'));

  assert.equal(isTerminal('DELIVERED'), true);
  assert.equal(isTerminal('RTO_DELIVERED'), true);
  assert.equal(isTerminal('CANCELLED'), true);
  assert.equal(isTerminal('IN_TRANSIT'), false);

  assert.equal(isBranch('PICKUP_FAILED'), true);
  assert.equal(isBranch('RTO_INITIATED'), true);
  assert.equal(isBranch('PICKED_UP'), false);

  assert.ok(rank('BOOKED') < rank('IN_TRANSIT'));
  assert.ok(rank('OUT_FOR_DELIVERY') < rank('DELIVERED'));
});

test('Security config: production startup rejects default or weak secrets', () => {
  assert.throws(
    () =>
      validateProductionSecrets({
        ...config,
        nodeEnv: 'production',
        jwtAccessSecret: 'dev-access-secret-change-me-0000000000',
        jwtRefreshSecret: 'dev-refresh-secret-change-me-000000000',
        encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      }),
    /Refusing production startup/,
  );

  const validIssues = validateProductionSecrets({
    ...config,
    nodeEnv: 'production',
    jwtAccessSecret: 'a-very-strong-production-access-secret-value-over-32-chars',
    jwtRefreshSecret: 'a-very-strong-production-refresh-secret-value-over-32-chars',
    encryptionKey: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  });
  assert.deepEqual(validIssues, []);
});

test('Payment HMAC verification: constant-time mock and Razorpay webhook signatures', () => {
  assert.equal(timingSafeEqualHex('abcd', 'abcd'), true);
  assert.equal(timingSafeEqualHex('abcd', 'abce'), false);
  assert.equal(timingSafeEqualHex('abcd', 'abcde'), false);
  assert.equal(timingSafeEqualHex('', ''), false);

  const prevKeyId = process.env.RAZORPAY_KEY_ID;
  const prevKeySecret = process.env.RAZORPAY_KEY_SECRET;
  const prevWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const prevNodeEnv = process.env.NODE_ENV;

  try {
    // 1. Mock gateway signature check
    delete process.env.RAZORPAY_KEY_ID;
    const mockOrder = 'mock_order_123';
    const mockPay = 'mock_pay_456';
    const sig = computeMockSignature(mockOrder, mockPay);
    assert.deepEqual(verifyClientPayment('ship_1', mockOrder, mockPay, sig), {
      valid: true,
      providerPaymentId: mockPay,
    });
    assert.deepEqual(verifyClientPayment('ship_1', mockOrder, mockPay, 'tampered'), {
      valid: false,
      providerPaymentId: undefined,
    });

    // 2. Razorpay webhook HMAC-SHA512 check
    const rawPayload = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1' } } } });
    process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_wh_test_secret_12345678';
    const validHmac = crypto
      .createHmac('sha512', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawPayload)
      .digest('hex');
    assert.equal(verifyRazorpayWebhook(rawPayload, validHmac), true);
    assert.equal(verifyRazorpayWebhook(rawPayload, '0'.repeat(128)), false);

    // Production refuses unsigned/unconfigured webhook secret
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';
    assert.equal(verifyRazorpayWebhook(rawPayload, validHmac), false);
  } finally {
    if (prevKeyId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = prevKeyId;
    if (prevKeySecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = prevKeySecret;
    if (prevWebhookSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = prevWebhookSecret;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }
});


test('Auth helpers: normalizeEmail and validatePasswordStrength', () => {
  assert.equal(normalizeEmail('  Alice.Book@Example.COM '), 'alice.book@example.com');
  assert.throws(() => validatePasswordStrength('short1'), /at least 8 characters/);
  assert.throws(() => validatePasswordStrength('onlyletters'), /letters and numbers/);
  assert.throws(() => validatePasswordStrength('12345678'), /letters and numbers/);
  assert.doesNotThrow(() => validatePasswordStrength('BookPass1'));
});
