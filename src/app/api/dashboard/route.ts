import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { startOfDay, endOfDay, subDays, startOfDay as sod } from 'date-fns';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const today = startOfDay(new Date());

    const todayPlans = await prisma.deliveryPlan.findMany({
      where: { planDate: { gte: today, lte: endOfDay(today) } },
      include: { routes: true },
    });

    const planCount = todayPlans.length;
    const completedCount = todayPlans.filter(p => p.status === 'COMPLETED').length;
    const inProgressCount = todayPlans.filter(p => p.status === 'IN_PROGRESS').length;

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
    const regularCount = allDrivers.filter(d => d.type === 'REGULAR').length;
    const spotCount = allDrivers.filter(d => d.type === 'SPOT').length;

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
      driverStatus: { regular: regularCount, spot: spotCount },
      unassignedTrucks,
      totalTrucks: allTrucks.length,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'ダッシュボードデータの取得に失敗しました' }, { status: 500 });
  }
}
