import { prisma } from '@/lib/prisma';

export const MAX_STOPS_PER_ROUTE = 40;

export async function checkTruckAvailable(
  planDate: Date,
  truckId: string,
  excludePlanId?: string
): Promise<boolean> {
  const existing = await prisma.planRoute.findFirst({
    where: {
      truckId,
      plan: {
        planDate,
        ...(excludePlanId ? { id: { not: excludePlanId } } : {}),
      },
    },
  });
  return !existing;
}

export async function checkDriverAvailable(
  planDate: Date,
  driverId: string,
  excludePlanId?: string
): Promise<boolean> {
  const existing = await prisma.planRoute.findFirst({
    where: {
      driverId,
      plan: {
        planDate,
        ...(excludePlanId ? { id: { not: excludePlanId } } : {}),
      },
    },
  });
  return !existing;
}

export async function checkSpotDriverAvailability(
  planDate: Date,
  driverId: string
): Promise<boolean> {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) return false;
  if (driver.type !== 'SPOT') return true;
  const availability = await prisma.spotAvailability.findUnique({
    where: { driverId_date: { driverId, date: planDate } },
  });
  return !!availability;
}
