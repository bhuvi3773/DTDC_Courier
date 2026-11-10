/* eslint-disable no-console */
import { PrismaClient, Role, ShipmentStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Constants (sections 2.1, 2.2, 2.6)
// ---------------------------------------------------------------------------

const ROLES: Array<{ name: Role; perms: string[] }> = [
  { name: 'SUPER_ADMIN', perms: ['*'] },
  { name: 'OPS_MANAGER', perms: ['shipment:read', 'shipment:update-tracking', 'carrier:manage', 'pricing:read'] },
  { name: 'CITY_MANAGER', perms: ['shipment:read', 'pricing:write', 'carrier:read'] },
  { name: 'HUB_MANAGER', perms: ['shipment:read', 'hub:manage', 'manifest:manage'] },
  { name: 'SUPERVISOR', perms: ['shipment:read', 'task:assign'] },
  { name: 'FINANCE', perms: ['finance:read', 'finance:refund'] },
  { name: 'SUPPORT', perms: ['ticket:read', 'ticket:manage'] },
  { name: 'ACCOUNT_MANAGER', perms: ['business:manage'] },
  { name: 'AGENT', perms: ['task:own', 'tracking:agent'] },
  { name: 'CUSTOMER', perms: ['shipment:create', 'shipment:own'] },
  { name: 'BUSINESS_OWNER', perms: ['business:read', 'shipment:create'] },
  { name: 'BUSINESS_USER', perms: ['shipment:create', 'bulk:upload'] },
];

const CITIES = [
  // Own-network active pair + one partner-only city.
  { name: 'Bengaluru', state: 'Karnataka', status: 'ACTIVE', zones: ['BENGALURU-C', 'BENGALURU-S'] },
  { name: 'Chennai', state: 'Tamil Nadu', status: 'ACTIVE', zones: ['CHENNAI-C'] },
  { name: 'Kochi', state: 'Kerala', status: 'INACTIVE', zones: ['KOCHI-N'] },
];

// ---------------------------------------------------------------------------
// Idempotent seed.
// ---------------------------------------------------------------------------

async function main() {
  console.log('Seeding book-courier…');

  // Raw helper table for AWB sequences (used by src/lib/awb.ts).
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS awb_sequence (
       ym TEXT PRIMARY KEY,
       v INTEGER NOT NULL
     );`,
  );

  // Roles + permissions (upsert, idempotent).
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: {},
      create: { name: r.name },
    });
    for (const permKey of r.perms) {
      const perm = await prisma.permission.upsert({
        where: { key: permKey },
        update: {},
        create: { key: permKey },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }
  console.log('  roles + permissions seeded');

  // Super admin user.
  const adminEmail = 'admin@bookcourier.local';
  const adminPass = await bcrypt.hash('admin1234', 10);
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const admin = await prisma.user.create({
      data: {
        name: 'Super Admin',
        email: adminEmail,
        phone: '9000000001',
        passwordHash: adminPass,
        isEmailVerified: true,
      },
    });
    const superAdminRole = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: superAdminRole!.id } });
  } else {
    await prisma.user.update({
      where: { id: existingAdmin.id },
      data: { isEmailVerified: true },
    });
  }
  console.log('  super admin seeded (admin@bookcourier.local / admin1234)');

  // Cities + pincodes + hubs.
  for (const c of CITIES) {
    const city = await prisma.city.upsert({
      where: { name: c.name },
      update: { status: c.status },
      create: { name: c.name, state: c.state, status: c.status as never },
    });
    for (const zone of c.zones) {
      const pincode = `${c.name.slice(0, 2).toUpperCase()}${zone.slice(-1)}001`.toLowerCase().replace(/[^\d]/g, '');
      const pc = c.name === 'Bengaluru' ? '560001' : c.name === 'Chennai' ? '600001' : '682001';
      await prisma.pincode.upsert({
        where: { pincode: pc },
        update: { zone },
        create: {
          pincode: pc,
          cityId: city.id,
          zone,
          ownPickup: c.status === 'ACTIVE' && c.name !== 'Chennai',
          ownDelivery: c.status === 'ACTIVE' && c.name !== 'Chennai',
          partnerServiceable: true,
        },
      });
    }
    if (c.status === 'ACTIVE' && c.name === 'Bengaluru') {
      await prisma.hub.upsert({
        where: { id: 'hub-bengaluru-main' },
        update: {},
        create: { id: 'hub-bengaluru-main', name: 'Bengaluru Central Hub', cityId: city.id, address: 'Magadi Road, Bengaluru' },
      });
    }
    if (c.status === 'ACTIVE' && c.name === 'Chennai') {
      await prisma.hub.upsert({
        where: { id: 'hub-chennai-main' },
        update: {},
        create: { id: 'hub-chennai-main', name: 'Chennai Guindy Hub', cityId: city.id, address: 'Guindy Industrial Estate, Chennai' },
      });
    }
  }
  // Second pincode for each active city + metro pincodes for nationwide quotes.
  await prisma.pincode.upsert({
    where: { pincode: '560038' },
    update: {},
    create: {
      pincode: '560038',
      cityId: (await prisma.city.findUnique({ where: { name: 'Bengaluru' } }))!.id,
      zone: 'BENGALURU-S',
      ownPickup: true,
      ownDelivery: true,
      partnerServiceable: true,
    },
  });

  const EXTRA_METROS = [
    { name: 'Mumbai', state: 'Maharashtra', zone: 'MUMBAI-W', pincode: '400001', hubId: 'hub-mumbai-main', hubName: 'Mumbai Andheri Hub', hubAddr: 'MIDC Andheri East, Mumbai' },
    { name: 'New Delhi', state: 'Delhi', zone: 'DELHI-NCR', pincode: '110001', hubId: 'hub-delhi-main', hubName: 'Delhi IGI Cargo Hub', hubAddr: 'Mahipalpur Ext, New Delhi' },
    { name: 'Hyderabad', state: 'Telangana', zone: 'HYD-C', pincode: '500001', hubId: 'hub-hyd-main', hubName: 'Hyderabad Shamshabad Hub', hubAddr: 'Shamshabad Logistics Park, Hyderabad' },
  ];
  for (const m of EXTRA_METROS) {
    const city = await prisma.city.upsert({
      where: { name: m.name },
      update: { status: 'ACTIVE' },
      create: { name: m.name, state: m.state, status: 'ACTIVE' },
    });
    await prisma.hub.upsert({
      where: { id: m.hubId },
      update: {},
      create: { id: m.hubId, name: m.hubName, cityId: city.id, address: m.hubAddr },
    });
    await prisma.pincode.upsert({
      where: { pincode: m.pincode },
      update: { zone: m.zone, ownPickup: true, ownDelivery: true, partnerServiceable: true },
      create: {
        pincode: m.pincode,
        cityId: city.id,
        zone: m.zone,
        ownPickup: true,
        ownDelivery: true,
        partnerServiceable: true,
      },
    });
  }
  console.log('  cities / pincodes / hubs seeded');

  // Agents & Employees (sample with email + password login support).
  const bngCity = await prisma.city.findUnique({ where: { name: 'Bengaluru' } });
  const staffDefaultPass = await bcrypt.hash('Staff1234', 10);
  for (const a of ['Agent Rama', 'Agent Sita']) {
    const phone = a === 'Agent Rama' ? '9100000001' : '9100000002';
    const email = a === 'Agent Rama' ? 'agent.rama@bookcourier.local' : 'agent.sita@bookcourier.local';
    const existingByPhone = await prisma.user.findUnique({ where: { phone } });
    const user = existingByPhone
      ? await prisma.user.update({
          where: { id: existingByPhone.id },
          data: {
            email: existingByPhone.email ?? email,
            passwordHash: existingByPhone.passwordHash ?? staffDefaultPass,
            isEmailVerified: true,
          },
        })
      : await prisma.user.create({
          data: {
            name: a,
            phone,
            email,
            passwordHash: staffDefaultPass,
            isEmailVerified: true,
          },
        });
    const agentRole = await prisma.role.findUnique({ where: { name: 'AGENT' } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: agentRole!.id } },
      update: {},
      create: { userId: user.id, roleId: agentRole!.id },
    });
    await prisma.agent.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, cityId: bngCity!.id, isOnline: true },
    });
  }

  const STAFF_ACCOUNTS: Array<{ name: string; email: string; phone: string; role: Role }> = [
    { name: 'Ops Manager', email: 'ops@bookcourier.local', phone: '9200000001', role: 'OPS_MANAGER' },
    { name: 'Hub Manager', email: 'hub@bookcourier.local', phone: '9200000002', role: 'HUB_MANAGER' },
    { name: 'Support Desk', email: 'support@bookcourier.local', phone: '9200000003', role: 'SUPPORT' },
    { name: 'Finance Officer', email: 'finance@bookcourier.local', phone: '9200000004', role: 'FINANCE' },
  ];
  for (const s of STAFF_ACCOUNTS) {
    const roleRow = await prisma.role.findUnique({ where: { name: s.role } });
    const existing = await prisma.user.findUnique({ where: { email: s.email } });
    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash: existing.passwordHash ?? staffDefaultPass,
            isEmailVerified: true,
          },
        })
      : await prisma.user.create({
          data: {
            name: s.name,
            email: s.email,
            phone: s.phone,
            passwordHash: staffDefaultPass,
            isEmailVerified: true,
          },
        });
    if (roleRow) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: roleRow.id } },
        update: {},
        create: { userId: user.id, roleId: roleRow.id },
      });
    }
  }
  console.log('  agents + employees seeded (password: Staff1234)');

  // Vehicles (sample fleet for Hub manifests).
  const VEHICLES: Array<{ id: string; regNo: string; type: string; capacityKg: number }> = [
    { id: 'veh-bng-01', regNo: 'KA-01-BC-1001', type: 'Tata Ace Mini Van', capacityKg: 750 },
    { id: 'veh-bng-02', regNo: 'KA-01-BC-2002', type: 'Eicher Linehaul 14ft', capacityKg: 2500 },
  ];
  for (const v of VEHICLES) {
    await prisma.vehicle.upsert({
      where: { regNo: v.regNo },
      update: {},
      create: { ...v, cityId: bngCity!.id },
    });
  }
  console.log('  vehicles seeded');

  // Carriers: OWN (enabled) + Pre-existing Partners (DTDC, DELHIVERY, BLUEDART, MOCK).
  await prisma.carrier.upsert({
    where: { code: 'OWN' },
    update: { isEnabled: true, name: 'Own Express Network' },
    create: { code: 'OWN', name: 'Own Express Network', type: 'OWN', isEnabled: true, settings: { mode: 'fleet' } },
  });

  const PARTNER_CARRIERS = [
    { code: 'DTDC', name: 'DTDC Express & AirMax', settings: { coverage: 'Domestic + 220 Countries', tiers: ['Express', 'AirMax', 'LTL'] } },
    { code: 'DELHIVERY', name: 'Delhivery Direct & PTL', settings: { coverage: 'Pan-India 18,700+ Pincodes', tiers: ['Express', 'PTL', 'FTL'] } },
    { code: 'BLUEDART', name: 'BlueDart Air Priority', settings: { coverage: 'Priority Air & Express', tiers: ['Air', 'Next-Day'] } },
    { code: 'MOCK', name: 'Mock Partner Simulator', settings: { sandbox: true } },
  ];

  const PARTNER_MAP: Array<[string, ShipmentStatus | null, string | null]> = [
    ['Picked Up', 'PICKED_UP', null],
    ['In Transit', 'IN_TRANSIT', null],
    ['Arrived at Hub', 'AT_DESTINATION_HUB', null],
    ['Out for Delivery', 'OUT_FOR_DELIVERY', null],
    ['Delivered', 'DELIVERED', null],
    ['Delivery Failed', 'DELIVERY_FAILED', null],
    ['Delayed', null, 'DELAYED'],
    ['Address Issue', null, 'ADDRESS_ISSUE'],
  ];

  for (const p of PARTNER_CARRIERS) {
    const carrierRow = await prisma.carrier.upsert({
      where: { code: p.code },
      update: { name: p.name, isEnabled: true, settings: p.settings as never },
      create: { code: p.code, name: p.name, type: 'PARTNER', isEnabled: true, settings: p.settings as never },
    });
    for (const [raw, internal, exc] of PARTNER_MAP) {
      const id = `${p.code.toLowerCase()}-${raw}`.replace(/\s+/g, '-').toUpperCase();
      await prisma.statusMapping.upsert({
        where: { id },
        update: { carrierId: carrierRow.id, rawStatus: raw, internalStatus: internal ?? null, exceptionCode: exc ?? null },
        create: { id, carrierId: carrierRow.id, rawStatus: raw, internalStatus: internal ?? null, exceptionCode: exc ?? null },
      });
    }
  }
  console.log('  carriers + status mappings seeded (OWN, DTDC, DELHIVERY, BLUEDART, MOCK)');

  // Pricing config defaults (volumetric divisor, weight step, tax, fees).
  const cfg: Array<[string, number | string]> = [
    ['volumetricDivisor', 5000],
    ['weightStepKg', 0.5],
    ['taxRate', 0.18],
    ['protectionRate', 0.01],
    ['pickupFee', 50],
    ['packagingFee', 30],
    ['fragilePackagingFee', 150],
    ['tempPackagingFee', 220],
    ['codFee', 40],
    ['codMaxAmount', 25000],
    ['serviceSurcharge', 0],
    ['ROUTING_STRATEGY', 'AUTO_OPTIMIZED'],
    ['HYBRID_ENABLED', 0],
    ['MAX_DELIVERY_ATTEMPTS', 3],
    ['DELIVERY_OTP_ENABLED', 1],
  ];
  for (const [key, value] of cfg) {
    await prisma.pricingConfig.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value) },
    });
  }

  await prisma.pricingConfig.upsert({
    where: { key: 'COMPANY_PROFILE' },
    update: {},
    create: {
      key: 'COMPANY_PROFILE',
      value: {
        brandName: 'BookCourier Express Logistics',
        gstin: '29AABCB1234F1Z5',
        address: '12, MG Road, Bengaluru, Karnataka - 560001',
        supportEmail: 'support@bookcourier.local',
        supportPhone: '+91 80 4567 8900',
      },
    },
  });

  console.log('  pricing config keys seeded');

  // Pricing rules (slabs) for the own-network & national corridors.
  type SeedServiceType =
    | 'LOCAL'
    | 'INTERCITY'
    | 'EXPRESS'
    | 'EXPRESS_PREMIUM'
    | 'AIRMAX'
    | 'LTL_FREIGHT'
    | 'FTL_FREIGHT'
    | 'INTERNATIONAL'
    | 'HYPERLOCAL'
    | 'SCHEDULED'
    | 'RETURN';
  const RULES: Array<[string, string, SeedServiceType, number, number, number]> = [
    // Bengaluru local / same-zone (560001 <-> 560038)
    ['BENGALURU-S', 'BENGALURU-S', 'LOCAL', 1, 79, 1],
    ['BENGALURU-S', 'BENGALURU-S', 'LOCAL', 5, 119, 1],
    ['BENGALURU-S', 'BENGALURU-S', 'LOCAL', 10, 189, 1],
    ['BENGALURU-S', 'BENGALURU-S', 'EXPRESS', 5, 199, 1],
    ['BENGALURU-S', 'BENGALURU-S', 'EXPRESS_PREMIUM', 5, 279, 1],
    ['BENGALURU-S', 'BENGALURU-S', 'HYPERLOCAL', 5, 159, 1],
    ['BENGALURU-S', 'BENGALURU-S', 'SCHEDULED', 5, 129, 1],
    ['BENGALURU-S', 'BENGALURU-S', 'RETURN', 5, 109, 2],
    // Cross-zone Bengaluru
    ['BENGALURU-C', 'BENGALURU-S', 'LOCAL', 1, 99, 1],
    ['BENGALURU-C', 'BENGALURU-S', 'LOCAL', 5, 149, 1],
    ['BENGALURU-C', 'BENGALURU-S', 'LOCAL', 10, 229, 1],
    ['BENGALURU-C', 'BENGALURU-S', 'EXPRESS', 5, 249, 1],
    ['BENGALURU-C', 'BENGALURU-S', 'HYPERLOCAL', 5, 189, 1],
    // Intercity & metro pairs
    ['BENGALURU-C', 'CHENNAI-C', 'INTERCITY', 5, 299, 3],
    ['BENGALURU-C', 'CHENNAI-C', 'INTERCITY', 10, 449, 3],
    ['CHENNAI-C', 'BENGALURU-C', 'INTERCITY', 5, 319, 3],
    ['BENGALURU-S', 'MUMBAI-W', 'INTERCITY', 5, 349, 3],
    ['BENGALURU-S', 'MUMBAI-W', 'EXPRESS_PREMIUM', 5, 599, 1],
    ['BENGALURU-S', 'DELHI-NCR', 'INTERCITY', 5, 399, 4],
    ['BENGALURU-S', 'DELHI-NCR', 'AIRMAX', 25, 1499, 1],
    ['BENGALURU-S', 'HYD-C', 'INTERCITY', 5, 279, 2],
    ['MUMBAI-W', 'DELHI-NCR', 'INTERCITY', 5, 359, 3],
    ['MUMBAI-W', 'DELHI-NCR', 'LTL_FREIGHT', 100, 1850, 4],
    ['BENGALURU-S', 'MUMBAI-W', 'FTL_FREIGHT', 1000, 14500, 3],
    ['BENGALURU-S', 'INTL-GLOBAL', 'INTERNATIONAL', 2, 1290, 5],
  ];
  for (const [oz, dz, st, maxW, price, eta] of RULES) {
    const id = `rule-${oz}-${dz}-${st}-${maxW}`.replace(/-/g, '_');
    await prisma.pricingRule.upsert({
      where: { id },
      update: { originZone: oz, destZone: dz, serviceType: st, maxWeightKg: maxW, price, etaDays: eta, isActive: true },
      create: {
        id,
        originZone: oz,
        destZone: dz,
        serviceType: st,
        maxWeightKg: maxW,
        price,
        etaDays: eta,
        isActive: true,
      },
    });
  }
  console.log('  pricing config + rules seeded');

  // Promotional Coupon Campaigns
  const PROMOS = [
    {
      code: 'SHIP25',
      description: '25% Off personal & parcel bookings (up to ₹250)',
      discountType: 'PERCENT',
      discountValue: 25,
      maxDiscount: 250,
      minOrderAmount: 100,
      usageLimit: 5000,
    },
    {
      code: 'EXPRESS15',
      description: '15% Off Express Premium, AirMax & Priority Shipments',
      discountType: 'PERCENT',
      discountValue: 15,
      maxDiscount: 350,
      minOrderAmount: 150,
      usageLimit: 2000,
    },
    {
      code: 'B2BFIRST',
      description: 'Flat ₹100 off on bulk & commercial dispatches above ₹350',
      discountType: 'FLAT',
      discountValue: 100,
      maxDiscount: 100,
      minOrderAmount: 350,
      usageLimit: 1000,
    },
  ];
  for (const pr of PROMOS) {
    await prisma.promoCode.upsert({
      where: { code: pr.code },
      update: { description: pr.description, isActive: true },
      create: { ...pr, isActive: true },
    });
  }
  console.log('  promo campaigns seeded (SHIP25, EXPRESS15, B2BFIRST)');

  // Demo customers + B2B corporate account (password: Book1234).
  const demoCustomerPass = await bcrypt.hash('Book1234', 10);
  for (const demo of ['Rahul Kumar', 'Priya Menon']) {
    const phone = demo === 'Rahul Kumar' ? '9000000010' : '9000000011';
    const email = demo.toLowerCase().replace(/\s/g, '.') + '@mail.com';
    let user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          name: demo,
          phone,
          email,
          passwordHash: demoCustomerPass,
          isEmailVerified: true,
        },
      });
      const custRole = await prisma.role.findUnique({ where: { name: 'CUSTOMER' } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: custRole!.id } });
    } else if (!user.passwordHash || !user.isEmailVerified) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          email: user.email ?? email,
          passwordHash: user.passwordHash ?? demoCustomerPass,
          isEmailVerified: true,
        },
      });
    }
    await prisma.customer.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, type: 'INDIVIDUAL' },
    });
  }

  // Approved B2B corporate account for Bulk CSV & Credit demo
  const bizEmail = 'business@bookcourier.local';
  const bizPhone = '9000000020';
  let bizUser = await prisma.user.findUnique({ where: { email: bizEmail } });
  if (!bizUser) {
    bizUser = await prisma.user.create({
      data: {
        name: 'Apex Enterprise Dispatch',
        email: bizEmail,
        phone: bizPhone,
        passwordHash: demoCustomerPass,
        isEmailVerified: true,
      },
    });
    const bizRole = await prisma.role.findUnique({ where: { name: 'BUSINESS_OWNER' } });
    if (bizRole) {
      await prisma.userRole.create({ data: { userId: bizUser.id, roleId: bizRole.id } });
    }
  }
  const bizAccount = await prisma.businessAccount.upsert({
    where: { id: 'biz-apex-001' },
    update: { isApproved: true, creditLimit: 50000 },
    create: {
      id: 'biz-apex-001',
      legalName: 'Apex Logistics & Commerce Pvt Ltd',
      gstin: '29AABCA9999K1Z2',
      creditLimit: 50000,
      isApproved: true,
    },
  });
  await prisma.businessContract.upsert({
    where: { id: 'contract-apex-001' },
    update: { ruleJson: { slabMultiplier: 0.88, label: '12% Corporate Volume Discount' } },
    create: {
      id: 'contract-apex-001',
      businessAccountId: bizAccount.id,
      ruleJson: { slabMultiplier: 0.88, label: '12% Corporate Volume Discount' },
      validFrom: new Date('2025-01-01T00:00:00Z'),
    },
  });
  await prisma.customer.upsert({
    where: { userId: bizUser.id },
    update: { type: 'BUSINESS', businessAccountId: bizAccount.id },
    create: { userId: bizUser.id, type: 'BUSINESS', businessAccountId: bizAccount.id },
  });
  console.log('  demo customers + B2B corporate account seeded (password: Book1234)');

  console.log('Seed complete ✔');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
