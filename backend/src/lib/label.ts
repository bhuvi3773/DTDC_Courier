import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { prisma } from './prisma';
import { ApiError } from './errors';

/**
 * Render an A5 courier shipping label PDF containing AWB, QR code,
 * package barcodes, sender/recipient addresses, and handling flags.
 */
export async function generateShippingLabelPdf(shipmentId: string): Promise<{ buffer: Buffer; awb: string }> {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      packages: true,
      legs: { orderBy: { sequence: 'asc' }, include: { carrier: true } },
      items: true,
      order: { select: { orderNo: true } },
    },
  });
  if (!shipment) throw ApiError.notFound('Shipment');

  const [pickupAddr, deliveryAddr, profileRow] = await Promise.all([
    prisma.address.findUnique({ where: { id: shipment.pickupAddressId } }),
    prisma.address.findUnique({ where: { id: shipment.deliveryAddressId } }),
    prisma.pricingConfig.findUnique({ where: { key: 'COMPANY_PROFILE' } }),
  ]);

  const company = (profileRow?.value as { brandName?: string } | null) ?? {};
  const headerBrand = company.brandName ? company.brandName.split(' ')[0] : 'BookCourier';

  const qrBuffer = await QRCode.toBuffer(shipment.awb, {
    type: 'png',
    width: 140,
    margin: 1,
  });

  const primaryLeg = shipment.legs[0];
  const carrierLabel =
    primaryLeg?.carrierType === 'PARTNER'
      ? `PARTNER: ${primaryLeg.carrier?.code ?? 'EXT'}${primaryLeg.externalAwb ? ` (${primaryLeg.externalAwb})` : ''}`
      : 'OWN FLEET NETWORK';

  const totalChargeable = shipment.packages.reduce(
    (sum, p) => sum + Number(p.chargeableWeightKg),
    0,
  );

  return new Promise<{ buffer: Buffer; awb: string }>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 20 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), awb: shipment.awb }));
    doc.on('error', reject);

    const left = 24;
    const width = 372; // A5 width 420 - 2*24
    let y = 24;

    // Outer Label Frame
    doc.lineWidth(1.5).rect(18, 18, 384, 559).stroke('#1e293b');

    // Header Banner
    doc.rect(18, 18, 384, 46).fill('#0f172a');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15).text(headerBrand, left + 4, 28);
    doc.font('Helvetica').fontSize(8).fillColor('#cbd5e1').text(carrierLabel, left + 4, 47);

    // Service Badge top-right
    doc.roundedRect(left + width - 118, 27, 112, 26, 4).fill(shipment.paymentMethod === 'COD' ? '#e11d48' : '#0d7a5f');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9.5).text(
      shipment.paymentMethod === 'COD' ? `COD Rs.${Number(shipment.codAmount ?? 0).toFixed(0)}` : shipment.serviceType,
      left + width - 118,
      35,
      { width: 112, align: 'center' },
    );

    y = 76;

    // QR Code + AWB section
    doc.image(qrBuffer, left + width - 98, y, { width: 92, height: 92 });

    doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(8).text('AIRWAY BILL (AWB)', left, y);
    y += 11;
    doc.fillColor('#0f172a').font('Courier-Bold').fontSize(16).text(shipment.awb, left, y);
    y += 22;

    doc.font('Helvetica').fontSize(9).fillColor('#334155');
    doc.text(
      `Channel: ${shipment.serviceType} (${shipment.destinationCountry})`,
      left,
      y,
    );
    y += 13;
    doc.text(
      `Weight: ${totalChargeable.toFixed(2)} kg  |  Units: ${shipment.bookCount}  |  Parcels: ${shipment.parcelCount}`,
      left,
      y,
    );
    y += 13;
    doc.text(
      `Booked: ${shipment.createdAt.toISOString().slice(0, 10)}  |  ETA: ${
        shipment.estimatedDeliveryAt ? shipment.estimatedDeliveryAt.toISOString().slice(0, 10) : 'TBD'
      }`,
      left,
      y,
    );
    y += 18;

    // Barcodes pill
    const barcodes = shipment.packages.map((p) => p.barcode).join(', ');
    doc.font('Courier').fontSize(8).fillColor('#475569').text(`PKG BARCODES: ${barcodes}`, left, y, {
      width: width - 108,
    });
    y = Math.max(y + 18, 178);

    // Divider
    doc.lineWidth(1).moveTo(18, y).lineTo(402, y).stroke('#cbd5e1');
    y += 12;

    // SHIP TO Box (Recipient)
    doc.roundedRect(left, y, width, 112, 4).lineWidth(1).stroke('#94a3b8');
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8).text('DELIVER TO (RECIPIENT)', left + 10, y + 8);
    if (deliveryAddr) {
      doc.font('Helvetica-Bold').fontSize(13).text(deliveryAddr.name, left + 10, y + 21);
      doc.font('Helvetica').fontSize(10).fillColor('#1e293b').text(deliveryAddr.line1, left + 10, y + 38, {
        width: width - 20,
      });
      doc.text(`${deliveryAddr.city}, ${deliveryAddr.state}`, left + 10, y + 54);
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text(`PIN: ${deliveryAddr.pincode}`, left + 10, y + 73);
      doc.font('Helvetica').fontSize(9).fillColor('#334155').text(`Phone: ${deliveryAddr.phone}`, left + 10, y + 92);
    }
    y += 124;

    // SHIP FROM Box (Sender)
    doc.roundedRect(left, y, width, 86, 4).lineWidth(0.75).stroke('#cbd5e1');
    doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(8).text('PICKUP FROM (SENDER)', left + 10, y + 8);
    if (pickupAddr) {
      doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(10).text(pickupAddr.name, left + 10, y + 20);
      doc.font('Helvetica').fontSize(9).text(
        `${pickupAddr.line1}, ${pickupAddr.city}, ${pickupAddr.state} - ${pickupAddr.pincode}`,
        left + 10,
        y + 34,
        { width: width - 20 },
      );
      doc.text(`Phone: ${pickupAddr.phone}`, left + 10, y + 62);
    }
    y += 98;

    // Handling & Operational Flags Box
    doc.rect(left, y, width, 74).fill('#f8fafc').stroke('#e2e8f0');
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8).text('HANDLING & VERIFICATION', left + 10, y + 8);
    doc.font('Helvetica').fontSize(8.5).fillColor('#334155');
    doc.text(`Packaging: ${shipment.packaging.replace(/_/g, ' ')}`, left + 10, y + 22);
    doc.text(
      `Protection: ${
        shipment.protectionOpted
          ? `INSURED (Declared Rs. ${shipment.declaredValue ?? 0})`
          : 'Standard Coverage'
      }`,
      left + 10,
      y + 35,
    );
    const slotText =
      shipment.pickupSlotStart && shipment.pickupSlotEnd
        ? `${shipment.pickupSlotStart.toISOString().slice(0, 16).replace('T', ' ')} -> ${shipment.pickupSlotEnd.toISOString().slice(11, 16)}`
        : 'Next Available Dispatch Window';
    doc.text(`Pickup Slot: ${slotText}`, left + 10, y + 48);

    const lastMileRule =
      primaryLeg?.carrierType === 'PARTNER'
        ? 'Handover: External Partner Tracking Applies'
        : 'Handover: 6-DIGIT DELIVERY OTP REQUIRED AT DOORSTEP';
    doc.font('Helvetica-Bold').fillColor('#1d4ed8').text(lastMileRule, left + 10, y + 61);

    // Footer
    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8').text(
      `Shipment ID: ${shipment.id}  |  Generated: ${new Date().toISOString()}`,
      left,
      556,
      { width, align: 'center' },
    );

    doc.end();
  });
}

