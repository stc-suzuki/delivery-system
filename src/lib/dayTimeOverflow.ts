// /api/pool・/api/capacity-overview の両方から使う、1日分の時間超過判定のアダプタ層。
// Prismaの型と timeOverflow.ts（純粋関数）の間の変換だけを担い、判定ロジック自体はtimeOverflow.tsに置く。
import { checkTimeOverflow, TruckDayInput, TimeOverflowResult } from './timeOverflow';
import { truckBed } from './loadCapacity';
import { PoolStopInput } from './loadAssignment';
import { Coord, LunchBreak, travelModelFromSettings } from './routeOptimizer';
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
  /** ルートの運行状況（PENDING/IN_PROGRESS/COMPLETED）。当日の計算の出発点を決めるのに使う */
  status?: string;
  /** 出発済みのルートの今いる場所（currentPosition.ts）。当日だけ使う */
  currentPos?: Coord;
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
  // 移動時間の見積もり（システム設定の平均時速・回り道係数・1区間の固定時間）
  averageSpeedKmh: number;
  roadDetourFactor: number;
  perLegTravelMinutes: number;
  /** 今の時刻。routeDateが今日（日本時間）のときだけ、出発済みのトラックを今の時刻・今いる場所から計算する */
  now?: Date;
}

function jstDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(d);
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

  // routeDateは@db.Date（UTCの0時）で保存されるため、UTCの日付部分がそのまま配送日になる
  const now = settings.now;
  const isToday = !!now && settings.routeDate.toISOString().slice(0, 10) === jstDateKey(now);

  const trucks: TruckDayInput[] = routes.map(r => {
    const base = {
      truckId: r.truckId,
      driverId: r.driverId,
      label: r.plateNo,
      capacityM3: r.capacityM3,
      bed: truckBed({ bedWidth: r.bedWidth, bedDepth: r.bedDepth, bedHeight: r.bedHeight }),
      assignedStops: r.assignedStops,
    };
    const departureTime = resolveDeparture(settings.routeDate, r.departureTime, settings.defaultDepartureTime);
    if (!isToday || !now || !r.status) return { ...base, departureTime };
    // 当日：稼働前のトラックは「出発時刻」と「今」の遅い方に本社を出る。出発済み（稼働中・配達完了・
    // 帰社済み）のトラックは今いる場所から今の時刻で計算し、未割当の配送先を積むなら本社へ戻って積み込む
    if (r.status === 'PENDING') {
      return { ...base, departureTime: departureTime.getTime() > now.getTime() ? departureTime : now };
    }
    return { ...base, departureTime: now, startPos: r.currentPos, reloadBeforePool: true };
  });

  return checkTimeOverflow(
    trucks,
    poolStops,
    deliveryEndTime,
    settings.loadUtilizationPercent,
    settings.reloadDurationMinutes,
    lunchBreak,
    settings.defaultStopDurationMinutes,
    { lat: settings.depotLat, lng: settings.depotLng },
    travelModelFromSettings(settings)
  );
}
