import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { format, addDays } from 'date-fns';
import { checkCapacityOverflow } from '@/lib/loadCapacity';
import { computeDayTimeOverflow, DayRouteInput } from '@/lib/dayTimeOverflow';
import { PoolStopInput } from '@/lib/loadAssignment';

// 引数を取らないGETは、本番の組み立て（next build）時に結果が固定されてしまうため、毎回DBから取得させる
export const dynamic = 'force-dynamic';

// 配送管理者向け：本日から「配車計画の先行登録可能日数」（SystemSetting.truckScheduleHorizonDays）分の
// 各日について、容積超過・時間超過の状況を一覧で見せる。/pool（1日ずつ確認する画面）を補完する俯瞰用エンドポイント。
// 判定ロジック自体は/api/poolのGETと同じ（loadCapacity.ts / dayTimeOverflow.ts）だが、
// 複数日をまとめて1クエリで扱う点だけが異なる

function isoDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const systemSetting = await prisma.systemSetting.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
    const horizonDays = systemSetting.truckScheduleHorizonDays;
    const loadUtilizationPercent = systemSetting.loadUtilizationPercent;
    const assumedTripsPerDay = systemSetting.assumedTripsPerDay;

    const dateStrs = Array.from({ length: horizonDays + 1 }, (_, i) => format(addDays(new Date(), i), 'yyyy-MM-dd'));
    const rangeStart = new Date(`${dateStrs[0]}T00:00:00.000Z`);
    const rangeEnd = new Date(`${dateStrs[dateStrs.length - 1]}T00:00:00.000Z`);

    const [stops, routes] = await Promise.all([
      prisma.deliveryStop.findMany({
        where: { stopDate: { gte: rangeStart, lte: rangeEnd } },
        select: {
          id: true,
          stopDate: true,
          routeId: true,
          locationId: true,
          status: true,
          requestedArrivalTime: true,
          location: { select: { name: true, lat: true, lng: true } },
          route: { select: { truckId: true } },
          packages: { select: { width: true, depth: true, height: true } },
        },
      }),
      prisma.planRoute.findMany({
        where: { routeDate: { gte: rangeStart, lte: rangeEnd } },
        select: {
          routeDate: true,
          truckId: true,
          driverId: true,
          departureTime: true,
          truck: { select: { plateNo: true, capacityM3: true, bedWidth: true, bedDepth: true, bedHeight: true } },
        },
      }),
    ]);

    const volumeByDate = new Map<string, number>();
    const unassignedLocationIdsByDate = new Map<string, Set<string>>();
    const routeInputsByDateAndTruck = new Map<string, Map<string, DayRouteInput>>();
    const poolStopsByDate = new Map<string, PoolStopInput[]>();

    for (const r of routes) {
      const key = isoDateKey(r.routeDate);
      if (!routeInputsByDateAndTruck.has(key)) routeInputsByDateAndTruck.set(key, new Map());
      const byTruck = routeInputsByDateAndTruck.get(key)!;
      if (byTruck.has(r.truckId)) continue;
      byTruck.set(r.truckId, {
        truckId: r.truckId,
        driverId: r.driverId,
        plateNo: r.truck.plateNo,
        capacityM3: r.truck.capacityM3,
        bedWidth: r.truck.bedWidth,
        bedDepth: r.truck.bedDepth,
        bedHeight: r.truck.bedHeight,
        departureTime: r.departureTime,
        assignedStops: [],
      });
    }

    for (const s of stops) {
      const key = isoDateKey(s.stopDate);
      if (s.status !== 'COMPLETED') {
        const vol = s.packages.reduce((sum, p) => sum + p.width * p.depth * p.height, 0);
        volumeByDate.set(key, (volumeByDate.get(key) ?? 0) + vol);
      }
      if (s.routeId === null) {
        if (!unassignedLocationIdsByDate.has(key)) unassignedLocationIdsByDate.set(key, new Set());
        unassignedLocationIdsByDate.get(key)!.add(s.locationId);

        const stopInput: PoolStopInput = {
          id: s.id,
          name: s.location.name,
          lat: s.location.lat,
          lng: s.location.lng,
          arrivalTime: s.requestedArrivalTime ? s.requestedArrivalTime.toISOString() : null,
          packages: s.packages,
        };
        if (!poolStopsByDate.has(key)) poolStopsByDate.set(key, []);
        poolStopsByDate.get(key)!.push(stopInput);
      } else if (s.status !== 'COMPLETED' && s.route) {
        const entry = routeInputsByDateAndTruck.get(key)?.get(s.route.truckId);
        if (entry) {
          entry.assignedStops.push({
            id: s.id,
            name: s.location.name,
            lat: s.location.lat,
            lng: s.location.lng,
            arrivalTime: s.requestedArrivalTime ? s.requestedArrivalTime.toISOString() : null,
            packages: s.packages,
          });
        }
      }
    }

    const days = dateStrs.map(date => {
      const volumeM3 = volumeByDate.get(date) ?? 0;
      const unassignedCount = unassignedLocationIdsByDate.get(date)?.size ?? 0;
      const routeInputs = Array.from((routeInputsByDateAndTruck.get(date) ?? new Map()).values());
      const setCapacities = routeInputs.map(r => r.capacityM3).filter((v): v is number => v != null);
      // /api/poolのGETと同じ考え方：1台＝1回の積み込みで1日分を配りきる前提ではなくなったため、
      // トラック容量の単純合計に「1日あたりの想定往復回数」を掛けた値を実効容量の元にする
      const totalM3 = setCapacities.reduce((sum, v) => sum + v, 0) * assumedTripsPerDay;
      const effectiveM3 = totalM3 * (loadUtilizationPercent / 100);
      const truckCount = routeInputs.length;
      const uncappedTruckCount = truckCount - setCapacities.length;
      const overflow = checkCapacityOverflow(effectiveM3 > 0 ? effectiveM3 : null, [volumeM3]);

      const timeResult = computeDayTimeOverflow(routeInputs, poolStopsByDate.get(date) ?? [], {
        routeDate: new Date(`${date}T00:00:00.000Z`),
        defaultDepartureTime: systemSetting.defaultDepartureTime,
        lunchBreakStart: systemSetting.lunchBreakStart,
        lunchBreakEnd: systemSetting.lunchBreakEnd,
        defaultStopDurationMinutes: systemSetting.defaultStopDurationMinutes,
        deliveryEndTime: systemSetting.deliveryEndTime,
        loadUtilizationPercent,
        reloadDurationMinutes: systemSetting.reloadDurationMinutes,
        depotLat: systemSetting.depotLat,
        depotLng: systemSetting.depotLng,
        averageSpeedKmh: systemSetting.averageSpeedKmh,
        roadDetourFactor: systemSetting.roadDetourFactor,
        perLegTravelMinutes: systemSetting.perLegTravelMinutes,
      });

      return {
        date,
        volumeM3,
        unassignedCount,
        truckCount,
        uncappedTruckCount,
        totalM3,
        effectiveM3,
        overCapacity: overflow.overCapacity,
        overTime: timeResult.overCapacityTime,
      };
    });

    return NextResponse.json({ days, loadUtilizationPercent, assumedTripsPerDay, deliveryEndTime: systemSetting.deliveryEndTime });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '容量状況の取得に失敗しました' }, { status: 500 });
  }
}
