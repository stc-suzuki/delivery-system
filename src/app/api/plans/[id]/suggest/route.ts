import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { effectiveCapacityM3, truckBed } from '@/lib/loadCapacity';
import { assignStopsToTrucks, AssignTruckInput, PoolStopInput } from '@/lib/loadAssignment';

// 手順③：自動割当（FFD）はあくまで参考データ。何も永続化しない。
// [id]で指定したルートと同日でまだ稼働していない全ルート（PENDING）、
// およびその日の未割当プールに対して毎回その場でFFDを計算し、参考の割当案を返すだけ。
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const anchorRoute = await prisma.planRoute.findUnique({ where: { id: params.id } });
    if (!anchorRoute) {
      return NextResponse.json({ error: '配送ルートが見つかりません' }, { status: 404 });
    }

    const batchRoutes = await prisma.planRoute.findMany({
      where: { routeDate: anchorRoute.routeDate, status: 'PENDING' },
      include: {
        truck: true,
        driver: true,
        trips: { orderBy: { tripIndex: 'asc' } },
        stops: { include: { packages: true } },
      },
    });
    if (batchRoutes.length === 0) {
      return NextResponse.json({ suggestions: [], unassignedStops: [] });
    }

    const poolStops = await prisma.deliveryStop.findMany({
      where: { stopDate: anchorRoute.routeDate, routeId: null },
      include: { location: true, packages: true },
    });

    const settings = await prisma.systemSetting.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });
    const [departureHour, departureMinute] = settings.defaultDepartureTime.split(':').map(Number);
    const departureTime = new Date(anchorRoute.routeDate);
    departureTime.setHours(departureHour, departureMinute, 0, 0);

    // 複数便対応：各便に既に割り当て済みの停車地の体積を求め、既存の便の空き容量を正しく把握する
    // （この計算をしないと、便を新設する前から既にある1便目の積載量を無視して過大に積んでしまう）
    const assignTruckInputs: AssignTruckInput[] = batchRoutes.map(r => {
      const volumeByTripId = new Map<string, number>();
      for (const stop of r.stops) {
        if (!stop.tripId) continue;
        const vol = stop.packages.reduce((sum, p) => sum + p.width * p.depth * p.height, 0);
        volumeByTripId.set(stop.tripId, (volumeByTripId.get(stop.tripId) ?? 0) + vol);
      }
      return {
        truckId: r.truckId,
        driverId: r.driverId,
        label: r.truck.plateNo,
        // 積み込み時の隙間を見込み、容積上限×積載利用率（システム設定）までしか積まない
        capacityM3: effectiveCapacityM3(r.truck.capacityM3, settings.loadUtilizationPercent),
        bed: truckBed(r.truck),
        trips: r.trips.map(t => ({ tripId: t.id, tripIndex: t.tripIndex, usedVolume: volumeByTripId.get(t.id) ?? 0 })),
      };
    });

    const poolStopInputs: PoolStopInput[] = poolStops.map(s => ({
      id: s.id,
      name: s.location.name,
      packages: s.packages,
      lat: s.location.lat,
      lng: s.location.lng,
      arrivalTime: s.requestedArrivalTime ? s.requestedArrivalTime.toISOString() : null,
    }));

    const result = assignStopsToTrucks(
      assignTruckInputs,
      poolStopInputs,
      departureTime,
      settings.assignmentStrategy,
      { lat: settings.depotLat, lng: settings.depotLng }
    );

    const routeIdByTruckId = new Map(batchRoutes.map(r => [r.truckId, r.id]));
    const stopById = new Map(poolStops.map(s => [s.id, s]));

    // 表示側（画面には「AI提案: このトラック」とだけ出す。便の区別までは出さない）は
    // これまで通りトラック単位の1つのリストにフラット化して返す
    const suggestions = result.assignments
      .map(a => ({ ...a, stopIds: a.trips.flatMap(t => t.stopIds) }))
      .filter(a => a.stopIds.length > 0)
      .map(a => ({
        routeId: routeIdByTruckId.get(a.truckId)!,
        truckId: a.truckId,
        stops: a.stopIds.map(stopId => {
          const s = stopById.get(stopId)!;
          return { stopId, locationId: s.locationId, locationName: s.location.name };
        }),
      }));

    const unassignedStops = result.unassignedStops.map(u => {
      const s = stopById.get(u.stopId)!;
      return {
        stopId: u.stopId,
        locationId: s.locationId,
        locationName: s.location.name,
        reason: u.reason,
        totalVolume: s.packages.reduce((sum, p) => sum + p.width * p.depth * p.height, 0),
      };
    });

    return NextResponse.json({ suggestions, unassignedStops });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '参考割当案の計算に失敗しました' }, { status: 500 });
  }
}
