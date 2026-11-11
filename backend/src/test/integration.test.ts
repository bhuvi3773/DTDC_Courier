import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { app } from '../server';
import { prisma } from '../lib/prisma';
import { signAccessToken } from '../lib/auth';
import { createRateLimiter } from '../middleware/security';

let server: http.Server;
let baseUrl = '';
let adminToken = '';
let customerToken = '';

let testCityId: string | null = null;
let testShipmentId: string | null = null;
let testExtraShipmentId: string | null = null;
let testInquiryId: string | null = null;
let testShipmentAwb: string | null = null;
let testTicketId: string | null = null;
let testSignupUserId: string | null = null;
let testSignupEmail: string | null = null;
const idemPrefix = `p10_${Date.now()}`;

interface ApiEnvelope<T> {
  data?: T;
  meta?: Record<string, unknown>;
  statusCode?: number;
  code?: string;
  message?: string;
}

interface ApiResult<T> {
  status: number;
  headers: Headers;
  json: ApiEnvelope<T> | null;
  raw: Buffer;
}

async function api<T = any>(
  path: string,
  opts: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') ?? '';
  let json: ApiEnvelope<T> | null = null;
  if (ct.includes('application/json')) {
    try {
      json = JSON.parse(buf.toString('utf8')) as ApiEnvelope<T>;
    } catch {
      json = null;
    }
  }
  return { status: res.status, headers: res.headers, json, raw: buf };
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Failed to bind ephemeral port');
      baseUrl = `http://127.0.0.1:${addr.port}/api`;
      resolve();
    });
  });

  // Authenticate seeded admin via HTTP login
  const loginRes = await api<{ accessToken: string }>('/auth/login', {
    body: { email: 'admin@bookcourier.local', password: 'admin1234' },
  });
  assert.equal(loginRes.status, 200);
  assert.ok(loginRes.json?.data?.accessToken);
  adminToken = loginRes.json!.data!.accessToken;

  // Issue customer token for seeded customer (9000000010)
  const customerUser = await prisma.user.findUnique({ where: { phone: '9000000010' } });
  assert.ok(customerUser, 'Seeded customer user 9000000010 must exist');
  customerToken = await signAccessToken({ id: customerUser.id, role: 'CUSTOMER' });
});

after(async () => {
  // Clean up synthetic test artifacts cleanly in reverse FK order
  if (testTicketId) {
    await prisma.ticketMessage.deleteMany({ where: { ticketId: testTicketId } });
    await prisma.ticket.deleteMany({ where: { id: testTicketId } });
  }
  if (testInquiryId) {
    await prisma.logisticsInquiry.deleteMany({ where: { id: testInquiryId } });
  }
  for (const sid of [testShipmentId, testExtraShipmentId].filter(Boolean) as string[]) {
    await prisma.notification.deleteMany({ where: { shipmentId: sid } });
    await prisma.invoice.deleteMany({ where: { shipmentId: sid } });
    await prisma.deliveryOtp.deleteMany({ where: { shipmentId: sid } });
    await prisma.task.deleteMany({ where: { shipmentId: sid } });
    await prisma.hubScan.deleteMany({ where: { shipmentId: sid } });
    await prisma.manifestItem.deleteMany({ where: { shipmentId: sid } });
    await prisma.trackingEvent.deleteMany({ where: { shipmentId: sid } });
    const pays = await prisma.payment.findMany({
      where: { shipmentId: sid },
      select: { id: true },
    });
    if (pays.length > 0) {
      await prisma.refund.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
    }
    await prisma.payment.deleteMany({ where: { shipmentId: sid } });
    await prisma.shipmentFinancial.deleteMany({ where: { shipmentId: sid } });
    await prisma.shipmentLeg.deleteMany({ where: { shipmentId: sid } });
    await prisma.shipmentItem.deleteMany({ where: { shipmentId: sid } });
    await prisma.package.deleteMany({ where: { shipmentId: sid } });
    await prisma.shipment.deleteMany({ where: { id: sid } });
  }
  await prisma.idempotencyKey.deleteMany({ where: { key: { contains: idemPrefix } } });
  if (testCityId) {
    await prisma.city.deleteMany({ where: { id: testCityId } });
  }
  if (testSignupEmail) {
    await prisma.otpCode.deleteMany({ where: { target: testSignupEmail } });
    await prisma.notification.deleteMany({ where: { target: testSignupEmail } });
  }
  if (testSignupUserId) {
    await prisma.refreshToken.deleteMany({ where: { userId: testSignupUserId } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: testSignupUserId } });
    await prisma.customer.deleteMany({ where: { userId: testSignupUserId } });
    await prisma.userRole.deleteMany({ where: { userId: testSignupUserId } });
    await prisma.user.deleteMany({ where: { id: testSignupUserId } });
  }

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await prisma.$disconnect();
});

test('Security middleware sets Helmet, X-Request-Id, and RateLimit headers', async () => {
  const customReqId = `req_${Date.now()}`;
  const res = await api('/health', { headers: { 'X-Request-Id': customReqId } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-request-id'), customReqId);
  assert.ok(res.headers.get('ratelimit-limit'), 'Expected RateLimit-Limit header');
  assert.ok(res.headers.get('ratelimit-remaining'), 'Expected RateLimit-Remaining header');
});

test('RBAC blocks unauthenticated (401) and non-admin (403) callers on admin endpoints', async () => {
  const unauth = await api('/admin/carriers');
  assert.equal(unauth.status, 401);

  const cust = await api('/admin/carriers', { token: customerToken });
  assert.equal(cust.status, 403);

  const adm = await api<Array<{ id: string }>>('/admin/carriers', { token: adminToken });
  assert.equal(adm.status, 200);
  assert.ok(Array.isArray(adm.json?.data));
});

test('City activation blocks INACTIVE city missing hub/pincode/pricing prerequisites', async () => {
  const created = await api<{ id: string }>('/serviceability/admin/cities', {
    token: adminToken,
    body: { name: `TestCity_${Date.now()}`, state: 'TestState' },
  });
  assert.equal(created.status, 201);
  testCityId = created.json!.data!.id;

  const activate = await api(`/serviceability/admin/cities/${testCityId}/activate`, {
    method: 'POST',
    token: adminToken,
    body: {},
  });
  assert.equal(activate.status, 422);
  assert.equal(activate.json?.code, 'CITY_ACTIVATION_BLOCKED');
});

test('End-to-end shipment booking with Idempotency-Key, payment, Delivery OTP, Invoice PDF, CSV, and Ticket', async () => {
  // 1. Quote OWN local shipment (560001 -> 560038)
  const quoteRes = await api<{ options: Array<{ optionId: string; mode: string; serviceType: string }> }>('/pricing/quote', {
    token: customerToken,
    body: {
      fromPincode: '560001',
      toPincode: '560038',
      serviceType: 'LOCAL',
      packaging: 'COMPANY_PACKED',
      ownOnly: true,
      dims: { lengthCm: 25, widthCm: 18, heightCm: 6, actualWeightKg: 1.0 },
    },
  });
  assert.equal(quoteRes.status, 200);
  const opt = quoteRes.json?.data?.options?.[0];
  assert.ok(opt, 'Expected at least one OWN routing option for 560001 -> 560038');

  // 2. Book shipment twice with identical Idempotency-Key -> same shipment returned
  const bookingPayload = {
    optionId: opt.optionId,
    shipmentType: 'CUSTOMER_OWN_BOOK_SHIPMENT',
    serviceType: 'LOCAL',
    packaging: 'COMPANY_PACKED',
    bookCount: 2,
    parcelCount: 1,
    declaredValue: 900,
    protectionOpted: true,
    fromPincode: '560001',
    toPincode: '560038',
    dims: { lengthCm: 25, widthCm: 18, heightCm: 6, actualWeightKg: 1.0 },
    pickupAddress: {
      name: 'Phase10 Test Sender',
      phone: '9000000010',
      line1: '10 Test Lane',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    },
    deliveryAddress: {
      name: 'Phase10 Test Recipient',
      phone: '9000000099',
      line1: '99 Indiranagar Rd',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560038',
    },
  };

  const shipKey = `${idemPrefix}_book`;
  const book1 = await api<{ shipment: { id: string; awb: string; status: string } }>('/shipments', {
    token: customerToken,
    body: bookingPayload,
    headers: { 'Idempotency-Key': shipKey },
  });
  assert.equal(book1.status, 201);
  testShipmentId = book1.json!.data!.shipment.id;
  testShipmentAwb = book1.json!.data!.shipment.awb;
  assert.match(testShipmentAwb, /^BC\d{11}$/);

  const book2 = await api<{ shipment: { id: string; awb: string } }>('/shipments', {
    token: customerToken,
    body: bookingPayload,
    headers: { 'Idempotency-Key': shipKey },
  });
  assert.equal(book2.status, 201);
  assert.equal(book2.json!.data!.shipment.id, testShipmentId);
  assert.equal(book2.json!.data!.shipment.awb, testShipmentAwb);

  // 3. Create payment order + verify via mock signed payload (idempotent)
  const orderRes = await api<{
    gateway: string;
    mockVerifyPayload?: { orderId: string; paymentId: string; signature: string };
  }>(`/payments/${testShipmentId}/create-order`, {
    token: customerToken,
    body: {},
  });
  assert.equal(orderRes.status, 201);
  assert.ok(orderRes.json?.data?.mockVerifyPayload);

  const payRes = await api<{ paid: boolean; awb: string }>(`/payments/${testShipmentId}/verify`, {
    token: customerToken,
    body: orderRes.json!.data!.mockVerifyPayload,
    headers: { 'Idempotency-Key': `${idemPrefix}_pay` },
  });
  assert.equal(payRes.status, 200);
  assert.equal(payRes.json?.data?.paid, true);

  // 4. Advance OWN leg to OUT_FOR_DELIVERY to trigger Delivery OTP issuance
  const curShip = await api<{ status: string }>(`/shipments/${testShipmentId}`, { token: adminToken });
  const curStatus = curShip.json!.data!.status;
  const steps =
    curStatus === 'BOOKED'
      ? ['PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY']
      : curStatus === 'PICKUP_SCHEDULED'
        ? ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY']
        : [];
  assert.ok(steps.length > 0, `Unexpected post-payment shipment status: ${curStatus}`);

  let otpCode: string | undefined;
  for (const nextStatus of steps) {
    const evRes: ApiResult<{ deliveryOtp?: { issued: boolean; code?: string } }> = await api<{
      deliveryOtp?: { issued: boolean; code?: string };
    }>(`/admin/shipments/${testShipmentId}/events`, {
      token: adminToken,
      body: { kind: 'STATUS', status: nextStatus, remarks: `test->${nextStatus}` },
    });
    assert.equal(evRes.status, 200);
    if (nextStatus === 'IN_TRANSIT') {
      const t1: ApiResult<{ task: { id: string } }> = await api<{ task: { id: string } }>('/tasks', {
        token: adminToken,
        body: { type: 'DELIVERY', shipmentId: testShipmentId },
      });
      const t2: ApiResult<{ task: { id: string } }> = await api<{ task: { id: string } }>('/tasks', {
        token: adminToken,
        body: { type: 'DELIVERY', shipmentId: testShipmentId },
      });
      assert.equal(t1.status, 201);
      assert.equal(t2.status, 201);
      assert.equal(t1.json?.data?.task.id, t2.json?.data?.task.id, 'Duplicate open DELIVERY task must be reused');
    }
    if (nextStatus === 'OUT_FOR_DELIVERY') {
      otpCode = evRes.json?.data?.deliveryOtp?.code;
    }
  }
  assert.ok(otpCode && /^\d{6}$/.test(otpCode), 'Expected 6-digit dev delivery OTP on OUT_FOR_DELIVERY');

  // 5. Wrong OTP rejected; valid OTP transitions shipment -> DELIVERED
  const badCode = otpCode === '000000' ? '111111' : '000000';
  const badVerify = await api(`/shipments/${testShipmentId}/verify-delivery-otp`, {
    token: customerToken,
    body: { code: badCode },
  });
  assert.ok(badVerify.status >= 400 && badVerify.status < 500, 'Expected 4xx for wrong delivery OTP');

  const goodVerify = await api<{ status: string }>(`/shipments/${testShipmentId}/verify-delivery-otp`, {
    token: customerToken,
    body: { code: otpCode },
  });
  assert.equal(goodVerify.status, 200);
  assert.equal(goodVerify.json?.data?.status, 'DELIVERED');

  const openAfterDeliver = await prisma.task.count({
    where: { shipmentId: testShipmentId!, status: { in: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] } },
  });
  assert.equal(openAfterDeliver, 0, 'Delivering shipment must close all remaining open tasks');

  const postDeliverTask = await api('/tasks', {
    token: adminToken,
    body: { type: 'DELIVERY', shipmentId: testShipmentId },
  });
  assert.equal(postDeliverTask.status, 422, 'Creating a task on a DELIVERED shipment must return 422');

  // 6. Invoice PDF & Reports CSV export
  const invoicePdf = await api(`/shipments/${testShipmentId}/invoice`, { token: customerToken });
  assert.equal(invoicePdf.status, 200);
  assert.match(invoicePdf.headers.get('content-type') ?? '', /application\/pdf/);
  assert.equal(invoicePdf.raw.subarray(0, 5).toString('ascii'), '%PDF-');

  const csvRes = await api('/reports/export/shipments.csv', { token: adminToken });
  assert.equal(csvRes.status, 200);
  const csvText = csvRes.raw.toString('utf8');
  assert.ok(csvText.includes('AWB,'), 'Expected CSV header row');
  assert.ok(csvText.includes(testShipmentAwb), 'Expected test shipment AWB in CSV export');

  // 7. Customer Support Ticket lifecycle: Open -> Admin reply -> Resolved
  const openTicket = await api<{ id: string; status: string }>('/tickets', {
    token: customerToken,
    body: {
      awbOrShipmentId: testShipmentAwb,
      type: 'COMPLAINT',
      subject: 'Phase 10 Automated Test Ticket',
      message: 'Testing end-to-end support ticket flow.',
    },
  });
  assert.equal(openTicket.status, 201);
  testTicketId = openTicket.json!.data!.id;

  const reply = await api(`/tickets/${testTicketId}/messages`, {
    token: adminToken,
    body: { body: 'Investigated and confirmed delivery.' },
  });
  assert.equal(reply.status, 201);

  const resolveTicket = await api<{ ticket: { status: string } }>(`/tickets/${testTicketId}/status`, {
    method: 'PATCH',
    token: adminToken,
    body: { status: 'RESOLVED', resolutionNote: 'Verified by automated suite' },
  });
  assert.equal(resolveTicket.status, 200);
  assert.equal(resolveTicket.json?.data?.ticket.status, 'RESOLVED');
});

test('Rate limiter middleware enforces 429 RATE_LIMITED when threshold exceeded', async () => {
  const miniApp = express();
  miniApp.use(
    '/limited',
    createRateLimiter({
      windowMs: 60_000,
      limit: () => 2,
      message: 'Rate limit exceeded',
    }),
    (_req, res) => res.json({ data: { ping: true } }),
  );

  const miniServer = await new Promise<http.Server>((resolve) => {
    const s = http.createServer(miniApp);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const addr = miniServer.address();
    if (!addr || typeof addr === 'string') throw new Error('Bad miniServer address');
    const url = `http://127.0.0.1:${addr.port}/limited`;

    const r1 = await fetch(url);
    const r2 = await fetch(url);
    const r3 = await fetch(url);

    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r3.status, 429);
    const body = (await r3.json()) as { statusCode?: number; code?: string };
    assert.equal(body.statusCode, 429);
    assert.equal(body.code, 'RATE_LIMITED');
  } finally {
    await new Promise<void>((resolve, reject) => {
      miniServer.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test('Complete Auth: Email OTP sign-up, password login (customer & employee), email OTP login, and password reset', async () => {
  testSignupEmail = `p10_auth_${Date.now()}@example.com`;
  const initialPass = 'BookPass123';
  const resetPass = 'BookPass999';

  // 1. Weak password rejected cleanly on signup/send-otp
  const weak = await api('/auth/register/send-otp', {
    body: {
      name: 'Auth Tester',
      email: testSignupEmail,
      password: 'weak',
      confirmPassword: 'weak',
    },
  });
  assert.equal(weak.status, 400);

  // 2. Sign Up with Email OTP verification
  const sendReg = await api<{ sent: boolean; email: string; devCode?: string }>('/auth/register/send-otp', {
    body: {
      name: 'Auth Tester',
      email: testSignupEmail,
      password: initialPass,
      confirmPassword: initialPass,
    },
  });
  assert.equal(sendReg.status, 200);
  assert.equal(sendReg.json?.data?.sent, true);
  assert.ok(sendReg.json?.data?.devCode && /^\d{6}$/.test(sendReg.json.data.devCode));

  const verifyReg = await api<{
    accessToken: string;
    role: string;
    user: { id: string; email: string; isEmailVerified: boolean };
  }>('/auth/register/verify', {
    body: {
      name: 'Auth Tester',
      email: testSignupEmail,
      password: initialPass,
      code: sendReg.json!.data!.devCode,
    },
  });
  assert.equal(verifyReg.status, 201);
  assert.equal(verifyReg.json?.data?.role, 'CUSTOMER');
  assert.equal(verifyReg.json?.data?.user.isEmailVerified, true);
  testSignupUserId = verifyReg.json!.data!.user.id;

  // 3. Customer password login works
  const passLogin = await api<{ accessToken: string; role: string }>('/auth/login', {
    body: { email: testSignupEmail.toUpperCase(), password: initialPass },
  });
  assert.equal(passLogin.status, 200);
  assert.equal(passLogin.json?.data?.role, 'CUSTOMER');

  // 4. Seeded Employee password login works (AGENT)
  const agentLogin = await api<{ accessToken: string; role: string }>('/auth/login', {
    body: { email: 'agent.rama@bookcourier.local', password: 'Staff1234' },
  });
  assert.equal(agentLogin.status, 200);
  assert.equal(agentLogin.json?.data?.role, 'AGENT');

  // 5. Email OTP Sign-In works
  const sendLoginOtp = await api<{ sent: boolean; devCode?: string }>('/auth/email-otp/send', {
    body: { email: testSignupEmail, purpose: 'LOGIN_EMAIL' },
  });
  assert.equal(sendLoginOtp.status, 200);
  assert.ok(sendLoginOtp.json?.data?.devCode);

  const verifyLoginOtp = await api<{ accessToken: string; role: string }>('/auth/email-otp/verify', {
    body: { email: testSignupEmail, code: sendLoginOtp.json!.data!.devCode },
  });
  assert.equal(verifyLoginOtp.status, 200);
  assert.ok(verifyLoginOtp.json?.data?.accessToken);

  // 6. Forgot Password -> Reset Password via Email OTP
  const forgotRes = await api<{ sent: boolean; devCode?: string }>('/auth/forgot-password', {
    body: { email: testSignupEmail },
  });
  assert.equal(forgotRes.status, 200);
  assert.ok(forgotRes.json?.data?.devCode);

  const resetRes = await api<{ reset: boolean }>('/auth/reset-password', {
    body: {
      email: testSignupEmail,
      code: forgotRes.json!.data!.devCode,
      newPassword: resetPass,
      confirmPassword: resetPass,
    },
  });
  assert.equal(resetRes.status, 200);
  assert.equal(resetRes.json?.data?.reset, true);

  // Old password rejected, new password succeeds
  const oldFail = await api('/auth/login', { body: { email: testSignupEmail, password: initialPass } });
  assert.equal(oldFail.status, 401);

  const newOk = await api<{ accessToken: string }>('/auth/login', {
    body: { email: testSignupEmail, password: resetPass },
  });
  assert.equal(newOk.status, 200);
});

test('DTDC/Delhivery Parity: Separated Partner Couriers, Promo SHIP25, International, COD Booking, Inquiries & Governance', async () => {
  // 1. Separated Partner Carriers Quote (DTDC / Delhivery / BlueDart) on EXPRESS_PREMIUM + Promo SHIP25
  const partnerQuote = await api<{
    options: Array<{ optionId: string; carrierCodes: string[]; breakdown?: { appliedPromoCode?: string; promoDiscount?: number } }>;
  }>('/pricing/quote', {
    token: customerToken,
    body: {
      fromPincode: '560001',
      toPincode: '400001',
      serviceType: 'EXPRESS_PREMIUM',
      packaging: 'TEMPERATURE_CONTROLLED',
      fulfillmentMode: 'PARTNER',
      promoCode: 'SHIP25',
      paymentMethod: 'COD',
      dims: { lengthCm: 25, widthCm: 18, heightCm: 10, actualWeightKg: 2 },
    },
  });
  assert.equal(partnerQuote.status, 200);
  const dtdcOpt = partnerQuote.json?.data?.options.find((o) => o.carrierCodes.includes('DTDC'));
  assert.ok(dtdcOpt, 'Expected separated DTDC partner carrier option');
  assert.equal(dtdcOpt.breakdown?.appliedPromoCode, 'SHIP25');
  assert.ok((dtdcOpt.breakdown?.promoDiscount ?? 0) > 0, 'Expected SHIP25 promo discount');

  // 2. Book PARTNER_DIRECT_SHIPMENT with COD -> dispatches immediately without prepayment
  const bookPartnerCod = await api<{ shipment: { id: string; awb: string; legs: Array<{ externalAwb?: string }> }; paymentOrder: { method: string } }>('/shipments', {
    token: customerToken,
    body: {
      optionId: dtdcOpt.optionId,
      shipmentType: 'PARTNER_DIRECT_SHIPMENT',
      fulfillmentMode: 'PARTNER',
      serviceType: 'EXPRESS_PREMIUM',
      packaging: 'TEMPERATURE_CONTROLLED',
      bookCount: 1,
      parcelCount: 1,
      paymentMethod: 'COD',
      promoCode: 'SHIP25',
      prohibitedConfirmed: true,
      fromPincode: '560001',
      toPincode: '400001',
      dims: { lengthCm: 25, widthCm: 18, heightCm: 10, actualWeightKg: 2 },
      pickupAddress: { name: 'COD Sender', phone: '9000000010', line1: '10 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
      deliveryAddress: { name: 'COD Recip', phone: '9000000099', line1: '50 Andheri', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
    },
    headers: { 'Idempotency-Key': `${idemPrefix}_partner_cod` },
  });
  assert.equal(bookPartnerCod.status, 201);
  testExtraShipmentId = bookPartnerCod.json!.data!.shipment.id;
  assert.ok(bookPartnerCod.json!.data!.shipment.legs[0]?.externalAwb?.startsWith('DTDC-'));

  // 3. International Quote (US) & Public Network Coverage work
  const [intlRes, netRes] = await Promise.all([
    api<{ options: Array<{ optionId: string }> }>('/pricing/quote', {
      body: {
        fromPincode: '560001',
        toPincode: '10001',
        serviceType: 'INTERNATIONAL',
        destinationCountry: 'US',
        dims: { lengthCm: 25, widthCm: 18, heightCm: 10, actualWeightKg: 2 },
      },
    }),
    api<{ internationalDestinations: Array<{ code: string }> }>('/serviceability/network'),
  ]);
  assert.equal(intlRes.status, 200);
  assert.ok((intlRes.json?.data?.options.length ?? 0) >= 1, 'Expected at least 1 International shipping option');
  assert.equal(netRes.status, 200);
  assert.ok((netRes.json?.data?.internationalDestinations.length ?? 0) >= 5);

  // 4. Cancel COD pre-pickup shipment + verify B2B bulk-quote, Inquiries & Admin COD/Audit endpoints
  const cancelRes = await api<{ shipment: { status: string } }>(`/shipments/${testExtraShipmentId}/cancel`, {
    token: customerToken,
    body: { reason: 'Integration test pre-pickup cancel' },
  });
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelRes.json?.data?.shipment.status, 'CANCELLED');

  const openAfterCancel = await prisma.task.count({
    where: { shipmentId: testExtraShipmentId!, status: { in: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] } },
  });
  assert.equal(openAfterCancel, 0, 'Cancelling shipment must close open pickup tasks');

  const inqRes = await api<{ id: string }>('/inquiries', {
    token: customerToken,
    body: {
      customerName: 'Test 3PL Lead',
      email: 'lead@example.com',
      phone: '9988776655',
      solutionType: '3PL_WAREHOUSING',
      notes: 'Need 2000 sqft pallet bay in Bengaluru Hub',
    },
  });
  assert.equal(inqRes.status, 201);
  testInquiryId = inqRes.json!.data!.id;

  const [bulkQ, codRep, auditRes] = await Promise.all([
    api<{ results: Array<{ ok: boolean }> }>('/b2b/bulk-quote', {
      token: customerToken,
      body: {
        rows: [
          {
            fromPincode: '560001',
            toPincode: '560038',
            recipientName: 'Bulk Test',
            recipientPhone: '9000000011',
            recipientLine1: '100ft Rd',
            recipientCity: 'Bengaluru',
            recipientState: 'Karnataka',
            weightKg: 1.5,
            serviceType: 'LOCAL',
            packaging: 'CUSTOMER_PACKED',
            fulfillmentMode: 'OWN',
            paymentMethod: 'PREPAID',
          },
        ],
      },
    }),
    api('/reports/cod', { token: adminToken }),
    api('/admin/audit-logs', { token: adminToken }),
  ]);
  assert.equal(bulkQ.status, 200);
  assert.equal(bulkQ.json?.data?.results[0]?.ok, true);
  assert.equal(codRep.status, 200);
  assert.equal(auditRes.status, 200);
});
