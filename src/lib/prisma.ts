import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma =
  // 本番では全SQLをログに出すと量が多くデータの中身も残るため、エラーだけにする
  globalForPrisma.prisma ?? new PrismaClient({ log: process.env.NODE_ENV === 'production' ? ['error'] : ['query'] });
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
