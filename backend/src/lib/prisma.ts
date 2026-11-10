import { PrismaClient } from '@prisma/client';

// Singleton Prisma client, lazily created so that importing this module
// does not require a live database connection. The generated client reads
// DATABASE_URL from the environment.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  (globalForPrisma.prisma = new PrismaClient({
    transactionOptions: {
      maxWait: 10_000,
      timeout: 25_000,
    },
  }));
