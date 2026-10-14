import { describe, expect, it } from 'vitest';
import { PoolStopInput } from './loadAssignment';
import { Coord } from './routeOptimizer';
import { TruckDayInput, checkTimeOverflow } from './timeOverflow';

const depot: Coord = { lat: 36.5657, lng: 139.8836 };
const KM_PER_DEGREE = (6371 * Math.PI) / 180;
const jst = (hhmm: string) => new Date(`2026-10-14T${hhmm}:00+09:00`);

function stopAt(id: string, bearing: number, km: number, vol = 0.1): PoolStopInput {
  const rad = (bearing * Math.PI) / 180;
  const side = Math.cbrt(vol);
  return {
    id,
    name: id,
    lat: depot.lat + (km * Math.cos(rad)) / KM_PER_DEGREE,
    lng: depot.lng + (km * Math.sin(rad)) / (KM_PER_DEGREE * Math.cos((depot.lat * Math.PI) / 180)),
    arrivalTime: null,
    packages: [{ width: side, depth: side, height: side }],
  };
}

function truck(id: string, capacityM3: number | null = null, opts: Partial<TruckDayInput> = {}): TruckDayInput {
  return {
    truckId: id,
    driverId: `driver-${id}`,
    label: id,
    capacityM3,
    bed: null,
    departureTime: jst('09:00'),
    assignedStops: [],
    ...opts,
  };
}

function expectTime(actual: Date | null, expected: Date) {
  expect(actual).not.toBeNull();
  expect(Math.abs(actual!.getTime() - expected.getTime())).toBeLessThan(1000);
}

// 本社から半径20kmの円周上に8方向へ散らばった配送先
const radialStops = Array.from({ length: 8 }, (_, i) => stopAt(`s${i + 1}`, i * 45, 20));

describe('checkTimeOverflow（荷物受付の定時超過判定）', () => {
  it('トラックが1台もなければ判定しない', () => {
    expect(checkTimeOverflow([], radialStops, jst('17:00'), 100, 30, undefined, 10, depot)).toEqual({
      overCapacityTime: false,
      truckResults: [],
    });
  });

  it('配送先がないトラックは本社帰着予定なし・超過なし', () => {
    const result = checkTimeOverflow([truck('t1')], [], jst('17:00'), 100, 30, undefined, 10, depot);
    expect(result.truckResults).toEqual([{ truckId: 't1', finishTime: null, overDeadline: false }]);
  });

  it('1台では定時に間に合わない量でも、2台に分ければ間に合うと判定する', () => {
    const one = checkTimeOverflow([truck('t1')], radialStops, jst('14:30'), 100, 30, undefined, 10, depot);
    expect(one.overCapacityTime).toBe(true);

    const two = checkTimeOverflow([truck('t1'), truck('t2')], radialStops, jst('14:30'), 100, 30, undefined, 10, depot);
    expect(two.overCapacityTime).toBe(false);
    // 片方に偏らず、両方のトラックが使われている
    expect(two.truckResults.every(r => r.finishTime !== null)).toBe(true);
  });

  it('容積上限を超えると本社に戻って積み直す時間（積み込み30分）を見込む', () => {
    // 同じ地点（真北15km）に1m3ずつ2件。容積1m3なら2便になる
    const stops = [stopAt('a', 0, 15, 1), stopAt('b', 0, 15, 1)];

    // 1便：9:30着→9:40荷下ろし完了→同じ地点9:40着→9:50完了→10:20本社着
    const noLimit = checkTimeOverflow([truck('t1', null)], stops, jst('17:00'), 100, 30, undefined, 10, depot);
    expectTime(noLimit.truckResults[0].finishTime, jst('10:20'));

    // 2便：10:10本社着→積み込み30分→10:40発→11:10着→11:20完了→11:50本社着
    const limited = checkTimeOverflow([truck('t1', 1)], stops, jst('17:00'), 100, 30, undefined, 10, depot);
    expectTime(limited.truckResults[0].finishTime, jst('11:50'));
  });

  it('本社での積み込みの途中で昼休みに入ったら、休憩明けに残りを済ませる', () => {
    // 10:49発→11:19着→11:29荷下ろし完了→11:59本社着→積み込み（1分＋休憩明け29分）→13:29発→13:59着→14:09完了→14:39本社着
    const stops = [stopAt('a', 0, 15, 1), stopAt('b', 0, 15, 1)];
    const lunch = { start: jst('12:00'), end: jst('13:00') };
    const result = checkTimeOverflow([truck('t1', 1, { departureTime: jst('10:49') })], stops, jst('17:00'), 100, 30, lunch, 10, depot);
    expectTime(result.truckResults[0].finishTime, jst('14:39'));
  });

  it('積載率の設定（loadUtilizationPercent）で実効容積を減らす', () => {
    // 容積2m3でも積載率50%なら実効1m3＝2便になる
    const stops = [stopAt('a', 0, 15, 1), stopAt('b', 0, 15, 1)];
    const result = checkTimeOverflow([truck('t1', 2)], stops, jst('17:00'), 50, 30, undefined, 10, depot);
    expectTime(result.truckResults[0].finishTime, jst('11:50'));
  });

  it('どのトラックの荷台にも入らない配送先は、時間の計算に含めない', () => {
    const crate: PoolStopInput = { ...stopAt('crate', 0, 15), packages: [{ width: 2.5, depth: 2.5, height: 1 }] };
    const result = checkTimeOverflow(
      [truck('t1', null, { bed: { width: 1.6, depth: 3, height: 1.8 } })],
      [crate],
      jst('17:00'),
      100,
      30,
      undefined,
      10,
      depot
    );
    expect(result.truckResults[0].finishTime).toBeNull();
  });
});
