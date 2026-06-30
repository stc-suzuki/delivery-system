import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canEditPlan } from '@/lib/planEditPolicy';
import { clusterLocations, orderWithTimeBudget, estimateStopTimes, TOCHIGI_DEPOT } from '@/lib/routeOptimizer';
import {
  checkTruckAvailable,
  checkDriverAvailable,
  checkDriverNotOnDayOff,
  MAX_STOPS_PER_ROUTE,
} from '@/lib/planValidation';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const plan = await prisma.deliveryPlan.findUnique({
      where: { id: params.id },
      include: { routes: true },
    });
    if (!plan) {
      return NextResponse.json({ error: '配送計画が見つかりません' }, { status: 404 });
    }
    if (!canEditPlan(plan)) {
      return NextResponse.json({ error: 'この配送計画は編集できません' }, { status: 403 });
    }

    const body = await req.json();
    const { locationIds, truckIds, driverIds, force, arrivalTimes, departureTime } = body as {
      locationIds: string[];
      truckIds: string[];
      driverIds: string[];
      force?: boolean;
      arrivalTimes?: Record<string, string>;
      departureTime?: string;
    };

    if (departureTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(departureTime)) {
      return NextResponse.json({ error: '出発時間はHH:mm形式で指定してください' }, { status: 400 });
    }

    if (!Array.isArray(locationIds) || !Array.isArray(truckIds) || !Array.isArray(driverIds)) {
      return NextResponse.json({ error: 'locationIds, truckIds, driverIds は配列で指定してください' }, { status: 400 });
    }
    if (truckIds.length === 0 || truckIds.length !== driverIds.length) {
      return NextResponse.json({ error: 'truckIds と driverIds は同数で1台以上指定してください' }, { status: 400 });
    }
    if (truckIds.length > 15) {
      return NextResponse.json({ error: 'トラックは最大15台までです' }, { status: 400 });
    }

    if (plan.routes.length > 0 && !force) {
      return NextResponse.json(
        { error: '既存のルートが存在します。再生成するには force: true を指定してください', existingRoutes: plan.routes.length },
        { status: 409 }
      );
    }

    // 重複・稼働チェック
    for (let i = 0; i < truckIds.length; i++) {
      const truckOk = await checkTruckAvailable(plan.planDate, truckIds[i], plan.id);
      if (!truckOk) {
        const truck = await prisma.truck.findUnique({ where: { id: truckIds[i] } });
        return NextResponse.json({ error: `トラック ${truck?.plateNo ?? truckIds[i]} は同日に既に割り当てられています` }, { status: 400 });
      }
      const driverOk = await checkDriverAvailable(plan.planDate, driverIds[i], plan.id);
      if (!driverOk) {
        const driver = await prisma.driver.findUnique({ where: { id: driverIds[i] } });
        return NextResponse.json({ error: `ドライバー ${driver?.name ?? driverIds[i]} は同日に既に割り当てられています` }, { status: 400 });
      }
      const dayOffOk = await checkDriverNotOnDayOff(plan.planDate, driverIds[i]);
      if (!dayOffOk) {
        const driver = await prisma.driver.findUnique({ where: { id: driverIds[i] } });
        return NextResponse.json({ error: `ドライバー ${driver?.name ?? driverIds[i]} は当日休日として設定されています` }, { status: 400 });
      }
    }

    const rawLocations = await prisma.location.findMany({
      where: { id: { in: locationIds } },
    });
    if (rawLocations.length === 0) {
      return NextResponse.json({ error: '配送先が指定されていません' }, { status: 400 });
    }

    const locations = rawLocations.map(l => ({
      ...l,
      arrivalTime: arrivalTimes?.[l.id] ?? null,
    }));

    const k = truckIds.length;
    const clusters = clusterLocations(locations, k);

    for (const cluster of clusters) {
      if (cluster.length > MAX_STOPS_PER_ROUTE) {
        return NextResponse.json(
          { error: `1ルートあたりの停車地は最大${MAX_STOPS_PER_ROUTE}件までです。配送先数またはトラック台数を見直してください` },
          { status: 400 }
        );
      }
    }

    const settings = await prisma.systemSetting.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });

    const [departureHour, departureMinute] = (departureTime ?? settings.defaultDepartureTime).split(':').map(Number);
    const departureDefault = new Date(plan.planDate);
    departureDefault.setHours(departureHour, departureMinute, 0, 0);

    const [lunchStartHour, lunchStartMinute] = settings.lunchBreakStart.split(':').map(Number);
    const lunchStart = new Date(plan.planDate);
    lunchStart.setHours(lunchStartHour, lunchStartMinute, 0, 0);
    const [lunchEndHour, lunchEndMinute] = settings.lunchBreakEnd.split(':').map(Number);
    const lunchEnd = new Date(plan.planDate);
    lunchEnd.setHours(lunchEndHour, lunchEndMinute, 0, 0);
    const lunchBreak = lunchEnd.getTime() > lunchStart.getTime() ? { start: lunchStart, end: lunchEnd } : undefined;

    const orderedClusters = clusters.map(cluster =>
      orderWithTimeBudget(TOCHIGI_DEPOT, departureDefault, cluster, lunchBreak)
    );

    const timedClusters = orderedClusters.map(cluster =>
      estimateStopTimes(TOCHIGI_DEPOT, departureDefault, cluster, lunchBreak, settings.defaultStopDurationMinutes)
    );

    const toHHMM = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const warnings: string[] = [];
    timedClusters.forEach(cluster =>
      cluster.forEach(stop => {
        if (stop.timeConflict) {
          warnings.push(
            `${stop.name}: 希望到着時刻 ${toHHMM(new Date(stop.arrivalTime as string))} には移動時間の都合で間に合わない可能性があります（推定到着 ${toHHMM(stop.estimatedTime)}）`
          );
        }
      })
    );

    const result = await prisma.$transaction(async tx => {
      // 既存ルートを差し替え
      if (plan.routes.length > 0) {
        const routeIds = plan.routes.map(r => r.id);
        await tx.deliveryStop.deleteMany({ where: { routeId: { in: routeIds } } });
        await tx.trackingLog.deleteMany({ where: { routeId: { in: routeIds } } });
        await tx.planRoute.deleteMany({ where: { planId: plan.id } });
      }

      const createdRoutes = [];
      for (let i = 0; i < k; i++) {
        const route = await tx.planRoute.create({
          data: {
            planId: plan.id,
            truckId: truckIds[i],
            driverId: driverIds[i],
            sortOrder: i,
            departureTime: departureDefault,
          },
        });

        const stops = timedClusters[i] ?? [];
        for (let j = 0; j < stops.length; j++) {
          await tx.deliveryStop.create({
            data: {
              routeId: route.id,
              locationId: stops[j].id,
              stopOrder: j,
              scheduledTime: stops[j].estimatedTime,
              isTimeFixed: !!stops[j].arrivalTime,
            },
          });
        }
        createdRoutes.push(route.id);
      }
      return createdRoutes;
    });

    const updatedPlan = await prisma.deliveryPlan.findUnique({
      where: { id: plan.id },
      include: {
        routes: {
          orderBy: { sortOrder: 'asc' },
          include: {
            truck: true,
            driver: true,
            stops: { orderBy: { stopOrder: 'asc' }, include: { location: true } },
          },
        },
      },
    });

    return NextResponse.json({ routeIds: result, plan: updatedPlan, warnings });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'ルート最適化に失敗しました' }, { status: 500 });
  }
}
