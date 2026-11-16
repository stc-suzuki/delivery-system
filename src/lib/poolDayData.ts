// 荷物受付の「空いている日時」の判定（/api/pool/availability・/api/pool/order）で使う、日ごとの入力の読み込み。
// /api/poolのGETと同じ内容（その日のトラック・割当済みで未完了の停車地・未割当の停車地）を、複数日まとめて読む
import { PrismaClient } from '@prisma/client';
import { DayRouteInput, DaySettings } from './dayTimeOverflow';
import { PoolStopInput } from './loadAssignment';
import { fetchCurrentPositions } from './currentPosition';
import { stopArrivalConstraint } from './timeBands';

export interface PoolDayData {
  date: string;
  routes: DayRouteInput[];
  poolStops: PoolStopInput[];
  /** その日の停車地の件数（割当済み・未割当とも） */
  stopCount: number;
  /** その日に停車地がある配送先 */
  locationIds: Set<string>;
  /** 停車地IDから配送先名（間に合わなくなる配送先の名前を出すため） */
  locationNameByStopId: Map<string, string>;
}

type Settings = Awaited<ReturnType<PrismaClient['systemSetting']['upsert']>>;

export function daySettingsFor(date: string, s: Settings, now: Date): DaySettings {
  return {
    routeDate: new Date(`${date}T00:00:00.000Z`),
    defaultDepartureTime: s.defaultDepartureTime,
    lunchBreakStart: s.lunchBreakStart,
    lunchBreakEnd: s.lunchBreakEnd,
    defaultStopDurationMinutes: s.defaultStopDurationMinutes,
    deliveryEndTime: s.deliveryEndTime,
    loadUtilizationPercent: s.loadUtilizationPercent,
    reloadDurationMinutes: s.reloadDurationMinutes,
    depotLat: s.depotLat,
    depotLng: s.depotLng,
    averageSpeedKmh: s.averageSpeedKmh,
    roadDetourFactor: s.roadDetourFactor,
    perLegTravelMinutes: s.perLegTravelMinutes,
    now,
  };
}

export async function loadPoolDays(prisma: PrismaClient, dates: string[], settings: Settings): Promise<PoolDayData[]> {
  const dayDates = dates.map(d => new Date(`${d}T00:00:00.000Z`));
  const [stops, routes] = await Promise.all([
    prisma.deliveryStop.findMany({
      where: { stopDate: { in: dayDates } },
      include: { location: true, packages: true, route: { select: { truckId: true } } },
      orderBy: { id: 'asc' },
    }),
    prisma.planRoute.findMany({
      where: { routeDate: { in: dayDates } },
      select: {
        id: true,
        routeDate: true,
        truckId: true,
        driverId: true,
        departureTime: true,
        status: true,
        truck: { select: { plateNo: true, capacityM3: true, bedWidth: true, bedDepth: true, bedHeight: true } },
      },
    }),
  ]);

  const currentPositions = await fetchCurrentPositions(
    prisma,
    routes.filter(r => r.status !== 'PENDING').map(r => r.id),
    { lat: settings.depotLat, lng: settings.depotLng }
  );

  return dates.map(date => {
    const dayStops = stops.filter(s => s.stopDate.toISOString().slice(0, 10) === date);
    const routeInputsByTruckId = new Map<string, DayRouteInput>();
    for (const r of routes) {
      if (r.routeDate.toISOString().slice(0, 10) !== date || routeInputsByTruckId.has(r.truckId)) continue;
      routeInputsByTruckId.set(r.truckId, {
        truckId: r.truckId,
        driverId: r.driverId,
        plateNo: r.truck.plateNo,
        capacityM3: r.truck.capacityM3,
        bedWidth: r.truck.bedWidth,
        bedDepth: r.truck.bedDepth,
        bedHeight: r.truck.bedHeight,
        departureTime: r.departureTime,
        assignedStops: [],
        status: r.status,
        currentPos: currentPositions.get(r.id),
      });
    }
    const toInput = (s: (typeof dayStops)[number]): PoolStopInput => ({
      id: s.id,
      name: s.location.name,
      lat: s.location.lat,
      lng: s.location.lng,
      ...stopArrivalConstraint(s),
      packages: s.packages,
    });
    const poolStops: PoolStopInput[] = [];
    for (const s of dayStops) {
      if (s.routeId === null) {
        poolStops.push(toInput(s));
        continue;
      }
      if (s.status === 'COMPLETED') continue;
      const entry = s.route ? routeInputsByTruckId.get(s.route.truckId) : undefined;
      if (entry) entry.assignedStops.push(toInput(s));
    }
    return {
      date,
      routes: Array.from(routeInputsByTruckId.values()),
      poolStops,
      stopCount: dayStops.length,
      locationIds: new Set(dayStops.map(s => s.locationId)),
      locationNameByStopId: new Map(dayStops.map(s => [s.id, s.location.name])),
    };
  });
}
