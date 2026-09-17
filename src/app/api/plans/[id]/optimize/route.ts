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

const toHHMM = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

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
    const { locationIds, truckIds, driverIds, force, arrivalTimes, departureTime, cargoRatios } = body as {
      locationIds: string[];
      truckIds: string[];
      driverIds: string[];
      force?: boolean;
      arrivalTimes?: Record<string, string>;
      departureTime?: string;
      cargoRatios?: Record<string, number>;
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

    if (cargoRatios) {
      for (const id of locationIds) {
        const ratio = cargoRatios[id];
        if (ratio !== undefined && (!Number.isInteger(ratio) || ratio < 10 || ratio > 100 || ratio % 10 !== 0)) {
          return NextResponse.json({ error: '荷量割合は10〜100の10%単位で指定してください' }, { status: 400 });
        }
      }
      const totalCargoRatio = locationIds.reduce((sum, id) => sum + (cargoRatios[id] ?? 0), 0);
      if (totalCargoRatio > 100) {
        return NextResponse.json({ error: '荷量割合の合計は100%以下にしてください' }, { status: 400 });
      }
    }

    // 既に稼働中（または完了）のルートがある場合は、完了・スキップ済み停車地を保持したまま
    // 未配達分のみを現在地から差分更新する（全削除・再生成は行わない）。
    const startedRoutes = plan.routes.filter(r => r.status !== 'PENDING');
    if (startedRoutes.length > 0) {
      if (plan.routes.length > 1) {
        return NextResponse.json(
          { error: '稼働中の複数ルートの同時編集には対応していません' },
          { status: 400 }
        );
      }
      const startedRoute = plan.routes[0];
      // トラック・ドライバーの変更禁止チェックを最優先で行う（DBアクセス前）
      if (
        truckIds.length !== 1 ||
        driverIds.length !== 1 ||
        truckIds[0] !== startedRoute.truckId ||
        driverIds[0] !== startedRoute.driverId
      ) {
        return NextResponse.json({ error: '稼働中はトラック・ドライバーを変更できません' }, { status: 400 });
      }
      if (startedRoute.status === 'COMPLETED') {
        return NextResponse.json({ error: 'このルートは既に完了しています' }, { status: 400 });
      }

      const routeWithStops = await prisma.planRoute.findUnique({
        where: { id: startedRoute.id },
        include: { stops: { include: { location: true }, orderBy: { stopOrder: 'asc' } } },
      });
      if (!routeWithStops) {
        return NextResponse.json({ error: 'ルートが見つかりません' }, { status: 404 });
      }

      const fixedStops = routeWithStops.stops.filter(s => s.status !== 'PENDING');
      const pendingStops = routeWithStops.stops.filter(s => s.status === 'PENDING');

      const fixedLocationIds = new Set(fixedStops.map(s => s.locationId));
      if (locationIds.some(id => fixedLocationIds.has(id))) {
        return NextResponse.json(
          { error: 'この配送先は既にこのルートで処理済みです。画面を再読み込みしてください' },
          { status: 400 }
        );
      }

      if (fixedStops.length + locationIds.length > MAX_STOPS_PER_ROUTE) {
        return NextResponse.json(
          { error: `1ルートあたりの停車地は最大${MAX_STOPS_PER_ROUTE}件までです` },
          { status: 400 }
        );
      }

      const pendingByLocationId = new Map(pendingStops.map(s => [s.locationId, s]));
      const newLocationIds = locationIds.filter(id => !pendingByLocationId.has(id));
      const newLocationsForRoute = newLocationIds.length > 0
        ? await prisma.location.findMany({ where: { id: { in: newLocationIds } } })
        : [];
      if (newLocationsForRoute.length !== newLocationIds.length) {
        return NextResponse.json({ error: '指定された配送先が見つかりません' }, { status: 400 });
      }

      const requestedIds = new Set(locationIds);
      const toDelete = pendingStops.filter(s => !requestedIds.has(s.locationId));
      const maxFixedOrder = fixedStops.length > 0 ? Math.max(...fixedStops.map(s => s.stopOrder)) : -1;

      // 現在地: 最新の位置情報 > 直近の配達済み地点 > 車庫
      const lastLog = await prisma.trackingLog.findFirst({
        where: { routeId: startedRoute.id },
        orderBy: { timestamp: 'desc' },
      });
      const lastCompletedStop = [...fixedStops].reverse().find(s => s.status === 'COMPLETED');
      const currentPos = lastLog
        ? { lat: lastLog.lat, lng: lastLog.lng }
        : lastCompletedStop
        ? { lat: lastCompletedStop.location.lat, lng: lastCompletedStop.location.lng }
        : TOCHIGI_DEPOT;

      const routeSettings = await prisma.systemSetting.upsert({
        where: { id: 'default' },
        update: {},
        create: { id: 'default' },
      });
      const routePlanDateBase = new Date(plan.planDate);
      const [rLunchStartHour, rLunchStartMinute] = routeSettings.lunchBreakStart.split(':').map(Number);
      const rLunchStart = new Date(routePlanDateBase);
      rLunchStart.setHours(rLunchStartHour, rLunchStartMinute, 0, 0);
      const [rLunchEndHour, rLunchEndMinute] = routeSettings.lunchBreakEnd.split(':').map(Number);
      const rLunchEnd = new Date(routePlanDateBase);
      rLunchEnd.setHours(rLunchEndHour, rLunchEndMinute, 0, 0);
      const routeLunchBreak =
        rLunchEnd.getTime() > rLunchStart.getTime() ? { start: rLunchStart, end: rLunchEnd } : undefined;

      const routeNow = new Date();

      type RouteCombined = {
        id: string;
        locationId: string;
        name: string;
        lat: number;
        lng: number;
        arrivalTime: string | null;
        cargoRatio: number;
        isExisting: boolean;
      };
      const routeCombined: RouteCombined[] = locationIds.map(id => {
        const existing = pendingByLocationId.get(id);
        if (existing) {
          const arrivalOverride = arrivalTimes ? arrivalTimes[id] : undefined;
          const arrivalTime =
            arrivalOverride !== undefined
              ? arrivalOverride
              : existing.isTimeFixed && existing.scheduledTime
              ? existing.scheduledTime.toISOString()
              : null;
          return {
            id: existing.id,
            locationId: id,
            name: existing.location.name,
            lat: existing.location.lat,
            lng: existing.location.lng,
            arrivalTime,
            cargoRatio: cargoRatios?.[id] ?? existing.cargoRatio,
            isExisting: true,
          };
        }
        const location = newLocationsForRoute.find(l => l.id === id)!;
        return {
          id: location.id,
          locationId: id,
          name: location.name,
          lat: location.lat,
          lng: location.lng,
          arrivalTime: arrivalTimes?.[id] ?? null,
          cargoRatio: cargoRatios?.[id] ?? 100,
          isExisting: false,
        };
      });

      const routeOrdered = orderWithTimeBudget(currentPos, routeNow, routeCombined, routeLunchBreak);
      const routeTimed = estimateStopTimes(
        currentPos,
        routeNow,
        routeOrdered,
        routeLunchBreak,
        routeSettings.defaultStopDurationMinutes
      );

      const routeWarnings: string[] = [];
      routeTimed.forEach(stop => {
        if (stop.timeConflict) {
          routeWarnings.push(
            `${stop.name}: 希望到着時刻 ${toHHMM(new Date(stop.arrivalTime as string))} には移動時間の都合で間に合わない可能性があります（推定到着 ${toHHMM(stop.estimatedTime)}）`
          );
        }
      });

      const updatedPlanForRoute = await prisma.$transaction(async tx => {
        if (toDelete.length > 0) {
          await tx.deliveryStop.deleteMany({ where: { id: { in: toDelete.map(s => s.id) } } });
        }

        for (let i = 0; i < routeTimed.length; i++) {
          const item = routeTimed[i];
          const stopOrder = maxFixedOrder + 1 + i;
          if (item.isExisting) {
            await tx.deliveryStop.update({
              where: { id: item.id },
              data: {
                stopOrder,
                scheduledTime: item.estimatedTime,
                isTimeFixed: !!item.arrivalTime,
                cargoRatio: item.cargoRatio,
              },
            });
          } else {
            await tx.deliveryStop.create({
              data: {
                routeId: startedRoute.id,
                locationId: item.locationId,
                stopOrder,
                scheduledTime: item.estimatedTime,
                isTimeFixed: !!item.arrivalTime,
                cargoRatio: item.cargoRatio,
              },
            });
          }
        }

        // 全停車地解決済みならルート・計画を完了にする（/api/tracking/stops/[id]と同じロジック）
        const finalStops = await tx.deliveryStop.findMany({ where: { routeId: startedRoute.id } });
        const allStopsResolved =
          finalStops.length > 0 && finalStops.every(s => s.status === 'COMPLETED' || s.status === 'SKIPPED');
        if (allStopsResolved && startedRoute.status !== 'COMPLETED') {
          await tx.planRoute.update({ where: { id: startedRoute.id }, data: { status: 'COMPLETED' } });
          const allRoutes = await tx.planRoute.findMany({ where: { planId: startedRoute.planId } });
          const allCompleted = allRoutes.every(r => (r.id === startedRoute.id ? true : r.status === 'COMPLETED'));
          if (allCompleted) {
            await tx.deliveryPlan.update({ where: { id: startedRoute.planId }, data: { status: 'COMPLETED' } });
          }
        }

        return tx.deliveryPlan.findUnique({
          where: { id: params.id },
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
      });

      return NextResponse.json({ routeIds: [startedRoute.id], plan: updatedPlanForRoute, warnings: routeWarnings });
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
              cargoRatio: cargoRatios?.[stops[j].id] ?? 100,
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
