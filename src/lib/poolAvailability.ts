// 荷物受付「新規の受付」の、日付×到着の指定ごとの○△×（2026-11-16導入）。
// ○＝余裕あり、△＝受け付けられるが余裕が少ない、×＝受け付けられない（理由つき）。
// 判定はtimeOverflow.tsのevaluateInsertion（今の状態に1件だけ足せるか）。先に受けた配送先の
// 時間指定・時間帯を崩す場合は×にする（先に受けた方を優先、2026-11-16決定）
import { PrismaClient } from '@prisma/client';
import { evaluateDayInsertions } from './dayTimeOverflow';
import { PoolStopInput } from './loadAssignment';
import { InsertionResult } from './timeOverflow';
import { loadPoolDays, daySettingsFor, PoolDayData } from './poolDayData';
import { TIME_BANDS, bandWindowOnDate } from './timeBands';
import { isDefaultDayOff } from './driverSchedule';

/** △にする余裕の目安：本社帰着予定が定時のこの分数前より遅ければ△ */
export const TIGHT_MARGIN_MINUTES = 30;

export type AvailabilityStatus = 'ok' | 'tight' | 'ng' | 'no-truck' | 'registered';

export interface AvailabilityCell {
  /** NONE＝指定なし、AM/MIDDAY/PM＝時間帯、TIME＝時刻指定 */
  key: string;
  status: AvailabilityStatus;
  /** ×・△の理由や補足 */
  reason: string | null;
  /** 到着予定（○△のとき） */
  arrival: string | null;
  /** 本社帰着予定（○△のとき） */
  finishTime: string | null;
}

export interface AvailabilityDay {
  date: string;
  stopCount: number;
  truckCount: number;
  cells: AvailabilityCell[];
}

export interface AvailabilityRequest {
  locationId: string;
  lat: number;
  lng: number;
  packages: { width: number; depth: number; height: number }[];
  /** 'band'＝指定なし＋3つの時間帯、'time'＝時刻指定（time: HH:mm） */
  mode: 'band' | 'time';
  time?: string;
}

function hhmm(d: Date): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

function jstDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(d);
}

/** 今日（日本時間）からhorizonDays日先までの日付。土日祝を除く設定なら除く */
export function candidateDates(now: Date, horizonDays: number, excludeWeekendsAndHolidays: boolean): string[] {
  const today = jstDateKey(now);
  const [y, m, d] = today.split('-').map(Number);
  const dates: string[] = [];
  for (let i = 0; i <= horizonDays; i++) {
    const local = new Date(y, m - 1, d + i);
    if (excludeWeekendsAndHolidays && isDefaultDayOff(local)) continue;
    const key = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    dates.push(key);
  }
  return dates;
}

/** 列（到着の指定）ごとに、候補の配送先に付ける条件 */
function columnsFor(req: AvailabilityRequest, date: string): { key: string; constraint: Partial<PoolStopInput>; label: string }[] {
  if (req.mode === 'time') {
    const t = req.time ?? '';
    return [{ key: 'TIME', constraint: { arrivalTime: new Date(`${date}T${t}:00+09:00`).toISOString() }, label: `${t}` }];
  }
  return [
    { key: 'NONE', constraint: {}, label: '指定なし' },
    ...TIME_BANDS.map(b => {
      const w = bandWindowOnDate(date, b);
      return { key: b.key, constraint: { windowStart: w.start.toISOString(), windowEnd: w.end.toISOString() }, label: b.label };
    }),
  ];
}

export function failureReason(
  r: InsertionResult,
  column: { key: string; label: string },
  deliveryEndTime: string,
  locationNameByStopId: Map<string, string>
): string {
  switch (r.failure) {
    case 'size':
      return 'この荷物が入る荷台のトラックがありません';
    case 'arrival': {
      const at = r.candidateArrival ? `（最短 ${hhmm(r.candidateArrival)}着）` : '';
      return column.key === 'TIME' ? `${column.label}に着けません${at}` : `この時間帯に着けません${at}`;
    }
    case 'breaks-others': {
      const names = r.brokenStopIds.map(id => locationNameByStopId.get(id) ?? '').filter(Boolean);
      const shown = names.slice(0, 2).join('、') + (names.length > 2 ? ` ほか${names.length - 2}件` : '');
      return `先に受けた配送先${r.brokenStopIds.length}件が時間指定・時間帯から外れます（${shown}）`;
    }
    case 'deadline':
      return `定時${deliveryEndTime}までに本社へ戻れません${r.failureFinishTime ? `（本社帰着予定 ${hhmm(r.failureFinishTime)}）` : ''}`;
    default:
      return '受け付けられません';
  }
}

/** 1日分の判定（読み込み済みのデータから） */
export function evaluateAvailabilityDay(
  day: PoolDayData,
  settings: Parameters<typeof daySettingsFor>[1],
  now: Date,
  req: AvailabilityRequest,
  candidateId = '__new__'
): { cells: AvailabilityCell[]; results: InsertionResult[] } {
  const columns = columnsFor(req, day.date);
  if (day.locationIds.has(req.locationId)) {
    return {
      cells: columns.map(c => ({ key: c.key, status: 'registered', reason: 'この配送先はこの日に登録済みです', arrival: null, finishTime: null })),
      results: [],
    };
  }
  if (day.routes.length === 0) {
    return {
      cells: columns.map(c => ({ key: c.key, status: 'no-truck', reason: 'トラック未登録', arrival: null, finishTime: null })),
      results: [],
    };
  }
  const candidates: PoolStopInput[] = columns.map(c => ({
    id: candidateId,
    name: '新しい配送先',
    lat: req.lat,
    lng: req.lng,
    arrivalTime: null,
    packages: req.packages,
    ...c.constraint,
  }));
  const daySettings = daySettingsFor(day.date, settings, now);
  const { results, deliveryEndTime } = evaluateDayInsertions(day.routes, day.poolStops, daySettings, candidates);
  const tightFrom = deliveryEndTime.getTime() - TIGHT_MARGIN_MINUTES * 60 * 1000;
  const cells = results.map((r, i): AvailabilityCell => {
    const col = columns[i];
    if (!r.ok) {
      return { key: col.key, status: 'ng', reason: failureReason(r, col, settings.deliveryEndTime, day.locationNameByStopId), arrival: null, finishTime: null };
    }
    const tight = !!r.finishTime && r.finishTime.getTime() > tightFrom;
    return {
      key: col.key,
      status: tight ? 'tight' : 'ok',
      reason: tight && r.finishTime ? `受け付けられますが余裕が少なめです（本社帰着予定 ${hhmm(r.finishTime)}）` : null,
      arrival: r.candidateArrival ? r.candidateArrival.toISOString() : null,
      finishTime: r.finishTime ? r.finishTime.toISOString() : null,
    };
  });
  return { cells, results };
}

export async function computeAvailability(prisma: PrismaClient, req: AvailabilityRequest, now: Date): Promise<AvailabilityDay[]> {
  const settings = await prisma.systemSetting.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
  const dates = candidateDates(now, settings.truckScheduleHorizonDays, settings.excludeWeekendsAndHolidays);
  const days = await loadPoolDays(prisma, dates, settings);
  return days.map(day => ({
    date: day.date,
    stopCount: day.stopCount,
    truckCount: day.routes.length,
    cells: evaluateAvailabilityDay(day, settings, now, req).cells,
  }));
}
