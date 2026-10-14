import { describe, expect, it } from 'vitest';
import { Coord } from './routeOptimizer';
import { planTrips } from './tripPlanning';

const KM_PER_DEGREE = (6371 * Math.PI) / 180;
const depot: Coord = { lat: 36.5657, lng: 139.8836 };
const northKm = (km: number) => ({ lat: depot.lat + km / KM_PER_DEGREE, lng: depot.lng, arrivalTime: null });

const jst = (hhmm: string) => new Date(`2026-10-14T${hhmm}:00+09:00`);
const lunch = { start: jst('12:00'), end: jst('13:00') };

function expectTime(actual: Date, expected: Date) {
  expect(Math.abs(actual.getTime() - expected.getTime())).toBeLessThan(1000);
}

describe('planTrips（複数便の時刻計算）', () => {
  it('2便目は、1便目の本社帰着＋積み込み時間に出発する', () => {
    // 1便目：9:00発→9:30着→荷下ろし10分→10:10本社着→積み込み30分→2便目10:40発
    const result = planTrips(depot, jst('09:00'), [[northKm(15)], [northKm(15)]], 30);
    expectTime(result.trips[0].returnedAt, jst('10:10'));
    expectTime(result.trips[1].departureTime, jst('10:40'));
    expectTime(result.trips[1].stops[0].estimatedTime, jst('11:10'));
    expectTime(result.trips[1].returnedAt, jst('11:50'));
  });

  it('積み込みの途中で昼休みに入ったら作業を止め、休憩明けに残りを済ませてから出発する', () => {
    // 11:59本社着→12:00までに1分、13:00から残り29分→13:29発
    const result = planTrips(depot, jst('10:49'), [[northKm(15)], [northKm(15)]], 30, lunch);
    expectTime(result.trips[0].returnedAt, jst('11:59'));
    expectTime(result.trips[1].departureTime, jst('13:29'));
  });

  it('昼休み中に本社へ着いた場合は、休憩明けから積み込む', () => {
    // 11:40発→20分走って昼休み→13:10配送先着→13:20荷下ろし完了→13:50本社着→積み込み30分→14:20発
    const result = planTrips(depot, jst('11:40'), [[northKm(15)], [northKm(15)]], 30, lunch);
    expectTime(result.trips[0].stops[0].estimatedTime, jst('13:10'));
    expectTime(result.trips[0].returnedAt, jst('13:50'));
    expectTime(result.trips[1].departureTime, jst('14:20'));
  });

  it('配送先が1件もない便は、出発時刻をそのまま帰着時刻にする', () => {
    const result = planTrips(depot, jst('09:00'), [[], [northKm(15)]], 30);
    expectTime(result.trips[0].returnedAt, jst('09:00'));
    expectTime(result.trips[1].departureTime, jst('09:30'));
  });
});
