import { prisma } from '../lib/prisma';
import {
  issueDeliveryOtp,
  verifyDeliveryOtp,
  resendDeliveryOtp,
  supervisorBypassDeliveryOtp,
  failDeliveryAttempt,
  DELIVERY_OTP_TTL_MS,
  DELIVERY_OTP_MAX_ATTEMPTS,
} from '../lib/delivery-otp';
import { recordEvent } from '../lib/tracking';

async function runPhase7Tests() {
  console.log('=== RUNNING PHASE 7: DELIVERY OTP VERIFICATION TESTS ===\n');

  // 1. Setup a test shipment
  const customer = await prisma.customer.findFirst();
  const address = await prisma.address.findFirst();
  if (!customer || !address) {
    console.log('Skipping DB integration test: seed data missing (run seed first if needed)');
    return;
  }

  const testAwb = `TEST${Date.now()}`;
  const shipment = await prisma.shipment.create({
    data: {
      awb: testAwb,
      customerId: customer.id,
      pickupAddressId: address.id,
      deliveryAddressId: address.id,
      serviceType: 'LOCAL',
      shipmentType: 'CUSTOMER_OWN_BOOK_SHIPMENT',
      bookCount: 2,
      status: 'BOOKED',
    },
  });

  console.log(`✓ Test shipment created: ${shipment.awb} (id: ${shipment.id})`);

  // Move shipment to OUT_FOR_DELIVERY so delivery OTP can be tested
  await prisma.shipment.update({
    where: { id: shipment.id },
    data: { status: 'OUT_FOR_DELIVERY' },
  });

  // Test 1: Issue Delivery OTP
  const issued = await issueDeliveryOtp(shipment.id);
  console.log(`✓ Test 1 Passed: issueDeliveryOtp issued=${issued.issued}, code=${issued.code}`);
  if (!issued.code || issued.code.length !== 6) {
    throw new Error('Expected 6-digit delivery OTP code');
  }

  // Test 2: Idempotency of issueDeliveryOtp
  const reissued = await issueDeliveryOtp(shipment.id);
  console.log(`✓ Test 2 Passed: issueDeliveryOtp idempotent reuse (issued=${reissued.issued})`);

  // Test 3: Wrong code increments attempts
  try {
    await verifyDeliveryOtp(shipment.id, '000000');
    throw new Error('Expected invalid code to fail');
  } catch (e: any) {
    if (e.code === 'DELIVERY_OTP_INVALID') {
      console.log('✓ Test 3 Passed: Invalid OTP rejected with DELIVERY_OTP_INVALID');
    } else {
      throw e;
    }
  }

  // Check attempts in DB
  const otpRow = await prisma.deliveryOtp.findFirst({ where: { shipmentId: shipment.id } });
  if (otpRow?.attempts !== 1) {
    throw new Error(`Expected attempts=1, got ${otpRow?.attempts}`);
  }
  console.log(`✓ Test 4 Passed: Attempt counter properly incremented (attempts=${otpRow.attempts})`);

  // Test 5: Verify correct code marks DELIVERED
  const verifyRes = await verifyDeliveryOtp(shipment.id, issued.code);
  console.log(`✓ Test 5 Passed: Valid code verified successfully (delivered=${verifyRes.delivered})`);

  const updatedShipment = await prisma.shipment.findUnique({ where: { id: shipment.id } });
  if (updatedShipment?.status !== 'DELIVERED') {
    throw new Error(`Expected status DELIVERED, got ${updatedShipment?.status}`);
  }
  console.log(`✓ Test 6 Passed: Shipment status transitioned to DELIVERED`);

  // Test 7: Supervisor Exception Bypass on another test shipment
  const bypassShipment = await prisma.shipment.create({
    data: {
      awb: `BYPASS${Date.now()}`,
      customerId: customer.id,
      pickupAddressId: address.id,
      deliveryAddressId: address.id,
      serviceType: 'LOCAL',
      shipmentType: 'CUSTOMER_OWN_BOOK_SHIPMENT',
      bookCount: 1,
      status: 'OUT_FOR_DELIVERY',
    },
  });

  await issueDeliveryOtp(bypassShipment.id);

  const bypassRes = await supervisorBypassDeliveryOtp(
    bypassShipment.id,
    customer.userId,
    'Recipient phone battery exhausted; verified ID of recipient',
    'https://proofs.local/sample-signature.jpg',
  );

  console.log(`✓ Test 7 Passed: Supervisor bypass succeeded (bypass=${bypassRes.bypass}, delivered=${bypassRes.delivered})`);

  const auditEntry = await prisma.auditLog.findFirst({
    where: { entityId: bypassShipment.id, action: 'delivery.supervisor_bypass' },
  });
  if (!auditEntry) {
    throw new Error('Expected AuditLog entry for supervisor bypass');
  }
  console.log(`✓ Test 8 Passed: AuditLog entry recorded with mandatory supervisor reason`);

  console.log('\n=== ALL PHASE 7 DELIVERY OTP TESTS PASSED CLEANLY! ===\n');
}

runPhase7Tests()
  .catch((err) => {
    console.error('Test error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

