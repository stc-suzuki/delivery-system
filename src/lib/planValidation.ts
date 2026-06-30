import { prisma } from '@/lib/prisma';
import { isDefaultDayOff } from '@/lib/driverSchedule';

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

export async function checkDriverNotOnDayOff(
  planDate: Date,
  driverId: string
): Promise<boolean> {
  if (isDefaultDayOff(planDate)) return false;
  const dayOff = await prisma.driverDayOff.findUnique({
    where: { driverId_date: { driverId, date: planDate } },
  });
  return !dayOff;
}
