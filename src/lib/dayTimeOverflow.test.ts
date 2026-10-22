import { describe, expect, it } from 'vitest';
import { computeDayTimeOverflow, DayRouteInput, DaySettings } from './dayTimeOverflow';
import { PoolStopInput } from './loadAssignment';

const depot = { lat: 36.5657, lng: 139.8836 };
const KM_PER_DEGREE = (6371 * Math.PI) / 180;
const jst = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+09:00`);

// 本社の真北（経線上なので距離の誤差なし）。時速30kmなので15kmで30分
function north(km: number) {
  return { lat: depot.lat + km / KM_PER_DEGREE, lng: depot.lng };
}

function poolStop(id: string, km: number, arrival: string | null): PoolStopInput {
  return { id, name: id, ...north(km), arrivalTime: arrival, packages: [{ width: 0.5, depth: 0.5, height: 0.5 }] };
}

function route(opts: Partial<DayRouteInput> = {}): DayRouteInput {
  return {
    truckId: 't1',
    driverId: 'd1',
    plateNo: 't1',
    capacityM3: null,
    bedWidth: null,
    bedDepth: null,
    bedHeight: null,
    departureTime: null,
    assignedStops: [],
    ...opts,
  };
}

function settings(date: string, now?: Date): DaySettings {
  return {
    routeDate: new Date(`${date}T00:00:00.000Z`),
    defaultDepartureTime: '09:15',
    lunchBreakStart: '12:00',
    lunchBreakEnd: '13:00',
    defaultStopDurationMinutes: 10,
    deliveryEndTime: '17:00',
    loadUtilizationPercent: 100,
    reloadDurationMinutes: 30,
    depotLat: depot.lat,
    depotLng: depot.lng,
    averageSpeedKmh: 30,
    roadDetourFactor: 1,
    perLegTravelMinutes: 0,
    now,
  };
}

describe('computeDayTimeOverflow（当日は今の時刻・今いる場所から見込む）', () => {
  const stop1430 = poolStop('s', 15, jst('2026-10-23', '14:30').toISOString());

  it('明日以降の日は、今の時刻に関係なく朝の出発時刻から計算する', () => {
    const r = computeDayTimeOverflow([route({ status: 'PENDING' })], [stop1430], settings('2026-10-23', jst('2026-10-22', '14:00')));
    expect(r.arrivalConflictStopIds).toEqual([]);
  });

  it('当日、出発時刻を過ぎても稼働前のトラックは、今から本社を出る前提で計算する', () => {
    // 14:10に本社を出る → 真北15kmに14:40着（14:30指定には間に合わない）
    const r = computeDayTimeOverflow([route({ status: 'PENDING' })], [stop1430], settings('2026-10-23', jst('2026-10-23', '14:10')));
    expect(r.arrivalConflictStopIds).toEqual(['s']);
  });

  it('当日、出発時刻より前なら、稼働前のトラックは出発時刻から計算する', () => {
    const r = computeDayTimeOverflow([route({ status: 'PENDING' })], [stop1430], settings('2026-10-23', jst('2026-10-23', '08:00')));
    expect(r.arrivalConflictStopIds).toEqual([]);
  });

  it('当日、稼働中のトラックは今いる場所から今の時刻で計算する', () => {
    // 13:00に真北15kmにいて、同じ場所の配送先を積んでいる → 13:00着・荷下ろし10分・本社まで30分 → 13:40帰着
    // （朝の出発時刻から計算すると10:25帰着になってしまう）
    const r = computeDayTimeOverflow(
      [route({ status: 'IN_PROGRESS', currentPos: north(15), assignedStops: [poolStop('loaded', 15, null)] })],
      [],
      settings('2026-10-23', jst('2026-10-23', '13:00'))
    );
    expect(r.truckResults[0].finishTime?.getTime()).toBe(jst('2026-10-23', '13:40').getTime());
  });

  it('当日、稼働中のトラックに未割当の配送先を積むときは、本社へ戻って積み込む時間を見込む', () => {
    // 13:00に真北15km → 本社13:30着 → 積み込み30分で14:00発 → 14:30着・荷下ろし10分 → 本社15:10帰着
    const r = computeDayTimeOverflow(
      [route({ status: 'IN_PROGRESS', currentPos: north(15) })],
      [poolStop('added', 15, null)],
      settings('2026-10-23', jst('2026-10-23', '13:00'))
    );
    expect(r.truckResults[0].finishTime?.getTime()).toBe(jst('2026-10-23', '15:10').getTime());
  });

  it('当日、帰社済みのトラックは本社から今の時刻で計算する', () => {
    // 15:00に本社 → 積み込み30分 → 15:30発 → 16:00着・荷下ろし10分 → 本社16:40帰着
    const r = computeDayTimeOverflow(
      [route({ status: 'COMPLETED', currentPos: north(0) })],
      [poolStop('added', 15, null)],
      settings('2026-10-23', jst('2026-10-23', '15:00'))
    );
    expect(r.truckResults[0].finishTime?.getTime()).toBe(jst('2026-10-23', '16:40').getTime());
  });
});
