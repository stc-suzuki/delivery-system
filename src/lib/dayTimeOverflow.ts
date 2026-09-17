// /api/pool・/api/capacity-overview の両方から使う、1日分の時間超過判定のアダプタ層。
// Prismaの型と timeOverflow.ts（純粋関数）の間の変換だけを担い、判定ロジック自体はtimeOverflow.tsに置く。
import { checkTimeOverflow, TruckDayInput, TimeOverflowResult } from './timeOverflow';
import { truckBed } from './loadCapacity';
import { PoolStopInput } from './loadAssignment';
import { LunchBreak } from './routeOptimizer';
import { resolveDeparture } from './routeReorder';

export interface DayRouteInput {
  truckId: string;
  driverId: string;
  plateNo: string;
  capacityM3: number | null;
  bedWidth: number | null;
  bedDepth: number | null;
  bedHeight: number | null;
  departureTime: Date | null;
  assignedStops: PoolStopInput[];
}

export interface DaySettings {
  routeDate: Date;
  defaultDepartureTime: string;
  lunchBreakStart: string;
  lunchBreakEnd: string;
  defaultStopDurationMinutes: number;
  deliveryEndTime: string;
  loadUtilizationPercent: number;
  // 複数便対応：容積上限に達して本社を経由するたびにかかる積み込み所要時間（分）
  reloadDurationMinutes: number;
  depotLat: number;
  depotLng: number;
}

function resolveTimeOnDate(date: Date, hhmm: string): Date {
  const d = new Date(date);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

export function computeDayTimeOverflow(
  routes: DayRouteInput[],
  poolStops: PoolStopInput[],
  settings: DaySettings
): TimeOverflowResult {
  const lunchStart = resolveTimeOnDate(settings.routeDate, settings.lunchBreakStart);
  const lunchEnd = resolveTimeOnDate(settings.routeDate, settings.lunchBreakEnd);
  const lunchBreak: LunchBreak | undefined =
    lunchEnd.getTime() > lunchStart.getTime() ? { start: lunchStart, end: lunchEnd } : undefined;
  const deliveryEndTime = resolveTimeOnDate(settings.routeDate, settings.deliveryEndTime);

  const trucks: TruckDayInput[] = routes.map(r => ({
    truckId: r.truckId,
    driverId: r.driverId,
    label: r.plateNo,
    capacityM3: r.capacityM3,
    bed: truckBed({ bedWidth: r.bedWidth, bedDepth: r.bedDepth, bedHeight: r.bedHeight }),
    departureTime: resolveDeparture(settings.routeDate, r.departureTime, settings.defaultDepartureTime),
    assignedStops: r.assignedStops,
  }));

  return checkTimeOverflow(
    trucks,
    poolStops,
    deliveryEndTime,
    settings.loadUtilizationPercent,
    settings.reloadDurationMinutes,
    lunchBreak,
    settings.defaultStopDurationMinutes,
    { lat: settings.depotLat, lng: settings.depotLng }
  );
}
