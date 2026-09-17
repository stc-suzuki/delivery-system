import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canEditRoute, getEditHorizonDays } from '@/lib/planEditPolicy';
import { MAX_STOPS_PER_ROUTE } from '@/lib/planValidation';
import { truckBed } from '@/lib/loadCapacity';
import { assignStopsToTrucks, AssignTruckInput, PoolStopInput } from '@/lib/loadAssignment';
import { reorderRoute } from '@/lib/routeReorder';

// 「参考の割当案をすべて反映」：/suggest と同じFFD計算を行い、その結果をそのまま
// 手動割当として確定する。すでに手動割当済みの停車地には一切触れない
// （このAPIは現時点で未割当（routeId未設定）のプールだけを対象にするため）。
// 反映後も個別の停車地は /stops/[stopId] で上書き調整できる。
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const anchorRoute = await prisma.planRoute.findUnique({ where: { id: params.id } });
    if (!anchorRoute) {
      return NextResponse.json({ error: '配送ルートが見つかりません' }, { status: 404 });
    }
    if (!canEditRoute(anchorRoute, await getEditHorizonDays())) {
      return NextResponse.json({ error: 'このルートは編集できません' }, { status: 403 });
    }

    const batchRoutes = await prisma.planRoute.findMany({
      where: { routeDate: anchorRoute.routeDate, status: 'PENDING' },
      include: {
        truck: true,
        trips: { orderBy: { tripIndex: 'asc' } },
        stops: { include: { packages: true } },
      },
    });
    if (batchRoutes.length === 0) {
      return NextResponse.json({ error: '先に使用可能なトラックを確定してください' }, { status: 400 });
    }

    const poolStops = await prisma.deliveryStop.findMany({
      where: { stopDate: anchorRoute.routeDate, routeId: null },
      include: { location: true, packages: true },
    });
    if (poolStops.length === 0) {
      return NextResponse.json({ error: '未割当の配送先がありません' }, { status: 400 });
    }

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
        capacityM3: r.truck.capacityM3,
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

    const existingCounts = new Map<string, number>();
    for (const r of batchRoutes) {
      existingCounts.set(r.id, await prisma.deliveryStop.count({ where: { routeId: r.id } }));
    }
    for (const assignment of result.assignments) {
      const newCount = assignment.trips.reduce((sum, t) => sum + t.stopIds.length, 0);
      if (newCount === 0) continue;
      const routeId = routeIdByTruckId.get(assignment.truckId)!;
      const total = (existingCounts.get(routeId) ?? 0) + newCount;
      if (total > MAX_STOPS_PER_ROUTE) {
        return NextResponse.json(
          { error: `1ルートあたりの停車地は最大${MAX_STOPS_PER_ROUTE}件までです。個別に手動割当してください` },
          { status: 400 }
        );
      }
    }

    const warnings: string[] = [];
    const affectedRouteIds = new Set<string>();

    await prisma.$transaction(async tx => {
      for (const assignment of result.assignments) {
        const routeId = routeIdByTruckId.get(assignment.truckId)!;
        for (const trip of assignment.trips) {
          if (trip.stopIds.length === 0) continue;
          await tx.deliveryStop.updateMany({
            where: { id: { in: trip.stopIds } },
            data: { routeId, tripId: trip.tripId },
          });
          affectedRouteIds.add(routeId);
        }
      }
      for (const routeId of Array.from(affectedRouteIds)) {
        const { warnings: w } = await reorderRoute(tx, routeId);
        warnings.push(...w);
      }
    });

    const stopById = new Map(poolStops.map(s => [s.id, s]));
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

    return NextResponse.json({ assignedCount: poolStops.length - unassignedStops.length, unassignedStops, warnings });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '参考案の反映に失敗しました' }, { status: 500 });
  }
}
