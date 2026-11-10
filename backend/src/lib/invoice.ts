import PDFDocument from 'pdfkit';
import { prisma } from './prisma';
import { ApiError } from './errors';
import { yearMonthNow } from './awb';

/**
 * Ensure a sequential GST Invoice row exists for `shipmentId`.
 * Self-healing & concurrency-safe via Postgres advisory transaction lock.
 */
export async function ensureShipmentInvoice(shipmentId: string) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      financial: true,
      order: true,
    },
  });
  if (!shipment) throw ApiError.notFound('Shipment');

  const existing = await prisma.invoice.findFirst({ where: { shipmentId } });
  if (existing) return existing;

  const ymmm = yearMonthNow();
  const prefix = `INV-${ymmm}-`;
  const totalAmount = shipment.order
    ? Number(shipment.order.total)
    : Number(shipment.financial?.customerPrice ?? 0);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'INV:' + ymmm}))`;

    const doubleCheck = await tx.invoice.findFirst({ where: { shipmentId } });
    if (doubleCheck) return doubleCheck;

    const latest = await tx.invoice.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
    });
    const lastSeq = latest ? Number(latest.number.slice(prefix.length)) || 0 : 0;
    const nextNumber = `${prefix}${String(lastSeq + 1).padStart(5, '0')}`;

    return tx.invoice.create({
      data: {
        number: nextNumber,
        shipmentId,
        total: String(totalAmount),
      },
    });
  });
}

/**
 * Render an A4 Tax Invoice PDF for a shipment (covers both Bookstore orders
 * and standalone Courier bookings, with CGST/SGST vs IGST split).
 */
export async function generateInvoicePdf(shipmentId: string): Promise<{ buffer: Buffer; invoiceNumber: string }> {
  const invoice = await ensureShipmentInvoice(shipmentId);
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      financial: true,
      packages: true,
      order: { include: { items: { include: { product: true } } } },
    },
  });
  if (!shipment) throw ApiError.notFound('Shipment');

  const [pickupAddr, deliveryAddr, customer, profileRow] = await Promise.all([
    prisma.address.findUnique({ where: { id: shipment.pickupAddressId } }),
    prisma.address.findUnique({ where: { id: shipment.deliveryAddressId } }),
    prisma.customer.findUnique({
      where: { id: shipment.customerId },
      include: { user: { select: { name: true, email: true, phone: true } } },
    }),
    prisma.pricingConfig.findUnique({ where: { key: 'COMPANY_PROFILE' } }),
  ]);

  const company = (profileRow?.value as {
    brandName?: string;
    gstin?: string;
    address?: string;
  } | null) ?? {};
  const brandName = company.brandName || 'BookCourier Express Logistics Pvt. Ltd.';
  const gstin = company.gstin || '29AABCB1234F1Z5';
  const companyAddr = company.address || '12, MG Road, Bengaluru, Karnataka - 560001';

  const freightTotal = Number(shipment.financial?.customerPrice ?? 0);
  const freightTax = Number(shipment.financial?.tax ?? 0);
  const freightBase = Math.max(0, freightTotal - freightTax);
  const refunded = Number(shipment.financial?.refunded ?? 0);
  const discount = Number(shipment.discountAmount ?? 0);
  const booksSubtotal = shipment.order ? Number(shipment.order.subtotal) : 0;
  const grandTotal = shipment.order ? Number(shipment.order.total) : freightTotal;

  const sameState =
    pickupAddr &&
    deliveryAddr &&
    pickupAddr.state.trim().toLowerCase() === deliveryAddr.state.trim().toLowerCase();

  return new Promise<{ buffer: Buffer; invoiceNumber: string }>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), invoiceNumber: invoice.number }));
    doc.on('error', reject);

    // Header
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(20).text('TAX INVOICE', 40, 42);
    doc.font('Helvetica').fontSize(9).fillColor('#475569').text(brandName, 40, 68);
    doc.text(`${companyAddr} | GSTIN: ${gstin}`, 40, 81);

    // Invoice Meta box top right
    doc.roundedRect(350, 40, 205, 76, 4).stroke('#cbd5e1');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(`Invoice No: ${invoice.number}`, 360, 49);
    doc.font('Helvetica').fontSize(8.5).fillColor('#334155');
    doc.text(`Issued: ${invoice.issuedAt.toISOString().slice(0, 10)}`, 360, 63);
    doc.text(`AWB: ${shipment.awb}`, 360, 76);
    doc.text(`Payment: ${shipment.paymentMethod} (${shipment.paymentStatus})`, 360, 89);
    if (shipment.ewayBillNumber) {
      doc.text(`E-Way Bill: ${shipment.ewayBillNumber}`, 360, 101);
    }

    let y = 130;
    doc.moveTo(40, y).lineTo(555, y).stroke('#cbd5e1');
    y += 14;

    // Billed To & Shipped To columns
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748b').text('BILLED TO', 40, y);
    doc.text('DELIVERED TO', 310, y);
    y += 14;

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10).text(
      customer?.user.name || pickupAddr?.name || 'Customer',
      40,
      y,
    );
    doc.text(deliveryAddr?.name || 'Recipient', 310, y);
    y += 14;

    doc.font('Helvetica').fontSize(9).fillColor('#334155');
    doc.text(
      pickupAddr ? `${pickupAddr.line1}, ${pickupAddr.city}, ${pickupAddr.state} - ${pickupAddr.pincode}` : 'Bengaluru Store',
      40,
      y,
      { width: 240 },
    );
    doc.text(
      deliveryAddr ? `${deliveryAddr.line1}, ${deliveryAddr.city}, ${deliveryAddr.state} - ${deliveryAddr.pincode}` : '',
      310,
      y,
      { width: 240 },
    );
    y += 30;
    doc.text(`Phone: ${customer?.user.phone || pickupAddr?.phone || '-'}`, 40, y);
    doc.text(`Phone: ${deliveryAddr?.phone || '-'}`, 310, y);

    y += 28;

    // Line Items Table Header
    doc.rect(40, y, 515, 22).fill('#f1f5f9');
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9);
    doc.text('Description / Item', 48, y + 6);
    doc.text('Qty / Wt', 340, y + 6, { width: 70, align: 'right' });
    doc.text('Amount (INR)', 440, y + 6, { width: 105, align: 'right' });
    y += 26;

    doc.font('Helvetica').fontSize(9).fillColor('#1e293b');

    // Book items if linked to an Order
    if (shipment.order && shipment.order.items.length > 0) {
      for (const item of shipment.order.items) {
        const lineTot = Number(item.unitPrice) * item.quantity;
        doc.text(`${item.product.title} (Book)`, 48, y, { width: 280 });
        doc.text(`${item.quantity}`, 340, y, { width: 70, align: 'right' });
        doc.text(`Rs. ${lineTot.toFixed(2)}`, 440, y, { width: 105, align: 'right' });
        y += 18;
      }
    }

    // Freight / Courier line
    const totalChargeable = shipment.packages.reduce((s, p) => s + Number(p.chargeableWeightKg), 0);
    doc.text(
      `Courier Freight & Packaging (${shipment.serviceType}, ${shipment.packaging.replace(/_/g, ' ')})`,
      48,
      y,
      { width: 285 },
    );
    doc.text(`${totalChargeable.toFixed(2)} kg`, 340, y, { width: 70, align: 'right' });
    doc.text(`Rs. ${freightBase.toFixed(2)}`, 440, y, { width: 105, align: 'right' });
    y += 24;

    doc.moveTo(40, y).lineTo(555, y).stroke('#e2e8f0');
    y += 12;

    // Summary & GST Split right aligned
    const summaryLeft = 330;
    const valLeft = 440;
    const drawRow = (label: string, amount: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor('#0f172a');
      doc.text(label, summaryLeft, y);
      doc.text(amount, valLeft, y, { width: 105, align: 'right' });
      y += bold ? 20 : 16;
    };

    if (booksSubtotal > 0) {
      drawRow('Books Subtotal', `Rs. ${booksSubtotal.toFixed(2)}`);
    }
    drawRow('Freight Taxable Value', `Rs. ${freightBase.toFixed(2)}`);

    if (sameState) {
      drawRow('CGST (9%)', `Rs. ${(freightTax / 2).toFixed(2)}`);
      drawRow('SGST (9%)', `Rs. ${(freightTax / 2).toFixed(2)}`);
    } else {
      drawRow('IGST (18%)', `Rs. ${freightTax.toFixed(2)}`);
    }

    if (refunded > 0) {
      drawRow('Refunds Credited', `- Rs. ${refunded.toFixed(2)}`);
    }

    doc.moveTo(summaryLeft, y).lineTo(555, y).stroke('#0f172a');
    y += 8;
    drawRow('GRAND TOTAL (INR)', `Rs. ${grandTotal.toFixed(2)}`, true);

    // Footer note
    doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(
      'This is a computer-generated GST tax invoice by BookCourier. Subject to Bengaluru jurisdiction.',
      40,
      760,
      { width: 515, align: 'center' },
    );

    doc.end();
  });
}

