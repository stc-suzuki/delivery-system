import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { startOfDay, endOfDay, subDays, startOfDay as sod } from 'date-fns';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const today = startOfDay(new Date());

    const todayPlans = await prisma.deliveryPlan.findMany({
      where: { planDate: { gte: today, lte: endOfDay(today) } },
      include: {
        routes: {
          include: {
            truck: true,
            driver: true,
            stops: { include: { location: true }, orderBy: { stopOrder: 'asc' } },
          },
        },
      },
    });

    const planCount = todayPlans.length;
    const completedCount = todayPlans.filter(p => p.status === 'COMPLETED').length;
    const inProgressCount = todayPlans.filter(p => p.status === 'IN_PROGRESS').length;

    const planSummaries = todayPlans.map(p => {
      const stops = p.routes.flatMap(r => r.stops);
      const completedStops = stops.filter(s => s.status === 'COMPLETED').length;
      return {
        id: p.id,
        planDate: p.planDate,
        status: p.status,
        note: p.note,
        routeCount: p.routes.length,
        stopCount: stops.length,
        completedStopCount: completedStops,
        drivers: p.routes.map(r => r.driver.name),
        trucks: p.routes.map(r => r.truck.plateNo),
        destinations: stops.map(s => ({
          id: s.id,
          name: s.location.name,
          status: s.status,
        })),
      };
    });

    // 過去7日の完了件数
    const last7days = [];
    for (let i = 6; i >= 0; i--) {
      const day = sod(subDays(today, i));
      const count = await prisma.deliveryStop.count({
        where: {
          status: 'COMPLETED',
          arrivedAt: { gte: day, lte: endOfDay(day) },
        },
      });
      last7days.push({ date: day.toISOString().slice(0, 10), count });
    }

    // ドライバー稼働状況
    const allDrivers = await prisma.driver.findMany();
    const todayRoutes = todayPlans.flatMap(p => p.routes);
    const routeByDriverId = new Map(todayRoutes.map(r => [r.driverId, r]));

    const driverStatusLabel = (routeStatus: string | undefined): 'IN_PROGRESS' | 'IDLE' | 'COMPLETED' => {
      if (routeStatus === 'IN_PROGRESS') return 'IN_PROGRESS';
      if (routeStatus === 'COMPLETED') return 'COMPLETED';
      return 'IDLE';
    };

    const driverList = allDrivers.map(d => {
      const route = routeByDriverId.get(d.id);
      return {
        id: d.id,
        name: d.name,
        type: d.type,
        status: driverStatusLabel(route?.status),
        truck: route?.truck.plateNo ?? null,
      };
    });

    const assignedTruckIds = new Set(
      todayPlans.flatMap(p => p.routes.map(r => r.truckId))
    );
    const allTrucks = await prisma.truck.findMany();
    const unassignedTrucks = allTrucks.filter(t => !assignedTruckIds.has(t.id)).length;

    return NextResponse.json({
      planCount,
      completedCount,
      inProgressCount,
      last7days,
      drivers: driverList,
      unassignedTrucks,
      totalTrucks: allTrucks.length,
      plans: planSummaries,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'ダッシュボードデータの取得に失敗しました' }, { status: 500 });
  }
}
