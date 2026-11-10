import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Primary AWB format (section 2.5):
 *   "BC" + YYMM + 6-digit zero-padded DB sequence + 1 Luhn check digit
 * Generated server-side, unique, never reused.
 *
 * The sequence counter is kept in a raw `awb_sequence` table (created by the
 * seed step). That table can be dropped by a `prisma db push --accept-data-loss`
 * or an out-of-band migration, which would reset the counter and cause the
 * allocator to hand out already-used AWB numbers. To be safe the allocator
 * is SELF-HEALING: before every issue it advances the counter to at least the
 * highest sequence number that already exists in the `shipment` table for the
 * current month, so collisions are impossible even after the counter is lost.
 */

/** Classic Luhn check digit computed over `digits` (most-significant first). */
export function luhnCheckDigit(digits: string): number {
  const arr = digits.split('').map((d) => Number(d));
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    let n = arr[arr.length - 1 - i];
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return (10 - (sum % 10)) % 10;
}

export function buildAwb(ymmm: string, seq: number): string {
  const body = `BC${ymmm}${String(seq).padStart(6, '0')}`;
  // Luhn is applied to the numeric portion only (YYMM + sequence), not the
  // "BC" prefix letters.
  const numeric = body.replace(/[^0-9]/g, '');
  return `${body}${luhnCheckDigit(numeric)}`;
}

export function yearMonthNow(now = new Date()): string {
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}${mm}`;
}

/**
 * Allocate the next unique AWB number. When called from inside a transaction
 * (the booking flow) pass that client so the allocation is written to the same
 * transaction and the advisory lock is held for its duration.
 */
export async function nextAwb(tx?: Prisma.TransactionClient): Promise<string> {
  const ymmm = yearMonthNow();

  const run = async (client: Prisma.TransactionClient) => {
    // Serialize concurrent allocations for this month with a transaction-level
    // advisory lock (released at commit/rollback).
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ymmm}))`;

    // Highest sequence already issued this month (parsed from existing AWBs):
    // BC<YYMM><6-digit seq><1 luhn>  =>  seq = SUBSTRING(awb, 7, 6).
    const maxFromShipments = await client.$queryRaw<{ m: number | null }[]>`
      SELECT MAX(CAST(SUBSTRING(awb, 7, 6) AS INTEGER)) AS m
      FROM "Shipment"
      WHERE LEFT(awb, 6) = 'BC' || ${ymmm}
    `;
    const shippedMax = maxFromShipments[0]?.m ?? 0;

    const row = await client.$queryRaw<{ v: number }[]>`
      INSERT INTO awb_sequence (ym, v)
      SELECT ${ymmm}, GREATEST(COALESCE(MAX(v), 0) + 1, ${shippedMax} + 1)
      FROM awb_sequence
      WHERE ym = ${ymmm}
      ON CONFLICT (ym) DO UPDATE SET v = GREATEST(awb_sequence.v + 1, ${shippedMax} + 1)
      RETURNING v
    `;
    return buildAwb(ymmm, row[0].v);
  };

  if (tx) return run(tx);
  return prisma.$transaction((t) => run(t));
}
