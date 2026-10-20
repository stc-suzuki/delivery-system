import { describe, expect, it } from 'vitest';
import {
  Coord,
  bearingDeg,
  estimateReturnToDepotTime,
  estimateStopTimes,
  haversine,
  nearestNeighborOrder,
  orderWithTimeBudget,
  skipLunchBreak,
  travelTimeMs,
  type TravelModel,
} from './routeOptimizer';

// 経線（南北方向）に沿った距離はhaversineで誤差なく求まるため、本社の真北に地点を置いて
// 「15km＝平均時速30kmでちょうど30分」のように移動時間を手計算できる形で検証する
const KM_PER_DEGREE = (6371 * Math.PI) / 180;
const depot: Coord = { lat: 36.5657, lng: 139.8836 };
const northKm = (km: number): Coord => ({ lat: depot.lat + km / KM_PER_DEGREE, lng: depot.lng });
const eastKm = (km: number): Coord => ({ lat: depot.lat, lng: depot.lng + km / (KM_PER_DEGREE * Math.cos((depot.lat * Math.PI) / 180)) });

const jst = (hhmm: string) => new Date(`2026-10-14T${hhmm}:00+09:00`);
const lunch = { start: jst('12:00'), end: jst('13:00') };

// 浮動小数点の誤差（ミリ秒未満）を許容して時刻を比べる
function expectTime(actual: Date, expected: Date) {
  expect(Math.abs(actual.getTime() - expected.getTime())).toBeLessThan(1000);
}

describe('haversine（2点間の距離）', () => {
  it('同じ地点は0km', () => {
    expect(haversine(depot, depot)).toBe(0);
  });

  it('真北に15km離れた地点は15km', () => {
    expect(haversine(depot, northKm(15))).toBeCloseTo(15, 6);
  });
});

describe('bearingDeg（本社から見た方位角）', () => {
  it('北は0度、東は90度付近、南は180度、西は270度付近', () => {
    expect(bearingDeg(depot, northKm(10))).toBeCloseTo(0, 6);
    expect(bearingDeg(depot, eastKm(10))).toBeCloseTo(90, 0);
    expect(bearingDeg(depot, northKm(-10))).toBeCloseTo(180, 6);
    expect(bearingDeg(depot, eastKm(-10))).toBeCloseTo(270, 0);
  });
});

describe('skipLunchBreak（昼休みにかかる時刻を休憩明けへ繰り下げる）', () => {
  it('昼休み前はそのまま', () => {
    expectTime(skipLunchBreak(jst('11:59'), lunch), jst('11:59'));
  });

  it('昼休み開始ちょうど・昼休み中は休憩明けへ', () => {
    expectTime(skipLunchBreak(jst('12:00'), lunch), jst('13:00'));
    expectTime(skipLunchBreak(jst('12:30'), lunch), jst('13:00'));
  });

  it('休憩明けちょうどはそのまま', () => {
    expectTime(skipLunchBreak(jst('13:00'), lunch), jst('13:00'));
  });

  it('昼休みの設定がなければそのまま', () => {
    expectTime(skipLunchBreak(jst('12:30')), jst('12:30'));
  });
});

describe('estimateStopTimes（各配送先の到着予定時刻）', () => {
  it('移動時間（距離÷時速30km）と荷下ろし時間（既定10分）を積み上げる', () => {
    const result = estimateStopTimes(depot, jst('09:00'), [northKm(15), northKm(30)]);
    expectTime(result[0].estimatedTime, jst('09:30'));
    // 1件目の荷下ろし10分＋次の15kmで30分
    expectTime(result[1].estimatedTime, jst('10:10'));
    expect(result.every(s => !s.timeConflict)).toBe(true);
  });

  it('荷下ろし時間を指定できる', () => {
    const result = estimateStopTimes(depot, jst('09:00'), [northKm(15), northKm(30)], undefined, 45);
    expectTime(result[1].estimatedTime, jst('10:45'));
  });

  it('到着希望時刻に間に合う場合は、希望時刻を到着予定にする', () => {
    const result = estimateStopTimes(depot, jst('09:00'), [{ ...northKm(15), arrivalTime: jst('11:00').toISOString() }]);
    expectTime(result[0].estimatedTime, jst('11:00'));
    expect(result[0].timeConflict).toBe(false);
  });

  it('到着希望時刻に間に合わない場合は、最短の到着時刻にして矛盾ありとする', () => {
    const result = estimateStopTimes(depot, jst('09:00'), [{ ...northKm(15), arrivalTime: jst('09:10').toISOString() }]);
    expectTime(result[0].estimatedTime, jst('09:30'));
    expect(result[0].timeConflict).toBe(true);
  });

  it('移動中に昼休みに入ったら運転も止めて休み、休憩明けに残りを走る', () => {
    // 11:40発・30分の移動：昼休み前に20分走り、13:00から残り10分→13:10着
    const result = estimateStopTimes(depot, jst('11:40'), [northKm(15)], lunch);
    expectTime(result[0].estimatedTime, jst('13:10'));
  });

  it('昼休みをまたぐ長い移動は、昼休みの1時間分だけ到着が遅れる', () => {
    // 11:50発・80分の移動（40km）：昼休みがなければ13:10着のところ、1時間休んで14:10着
    const result = estimateStopTimes(depot, jst('11:50'), [northKm(40)], lunch);
    expectTime(result[0].estimatedTime, jst('14:10'));
  });

  it('荷下ろしの途中で昼休みに入ったら作業を止め、休憩明けに残りを済ませてから出発する', () => {
    // 11:40着・荷下ろし45分：12:00までに20分、13:00から残り25分→13:25出発→30分走って13:55着
    const result = estimateStopTimes(depot, jst('11:10'), [northKm(15), northKm(30)], lunch, 45);
    expectTime(result[0].estimatedTime, jst('11:40'));
    expectTime(result[1].estimatedTime, jst('13:55'));
  });

  it('昼休み中に出発しようとした場合は、休憩明けに出発する', () => {
    // 12:30発の予定でも13:00まで出発せず、30分走って13:30着
    const result = estimateStopTimes(depot, jst('12:30'), [northKm(15)], lunch);
    expectTime(result[0].estimatedTime, jst('13:30'));
  });

  it('昼休み開始ちょうどに着いた場合は、休憩明けから荷下ろしする', () => {
    const result = estimateStopTimes(depot, jst('11:30'), [northKm(15)], lunch);
    expectTime(result[0].estimatedTime, jst('13:00'));
  });

  it('荷下ろしの終わりが昼休みにかかる場合は、休憩明けに次へ出発する', () => {
    // 11:50着→荷下ろし完了12:00（昼休み）→13:00出発→30分
    const result = estimateStopTimes(depot, jst('11:20'), [northKm(15), northKm(30)], lunch);
    expectTime(result[0].estimatedTime, jst('11:50'));
    expectTime(result[1].estimatedTime, jst('13:30'));
  });
});

describe('estimateReturnToDepotTime（本社帰着予定）', () => {
  it('最後の配送先の荷下ろし後、本社までの移動時間を足す', () => {
    expectTime(estimateReturnToDepotTime(depot, northKm(15), jst('09:00')), jst('09:40'));
  });

  it('本社への帰着が昼休み開始ちょうどなら、休憩明けの扱いにする', () => {
    // 11:20着→11:30出発→12:00着（昼休み開始ちょうど）→13:00
    expectTime(estimateReturnToDepotTime(depot, northKm(15), jst('11:20'), lunch), jst('13:00'));
  });

  it('最後の荷下ろしの途中で昼休みに入ったら、休憩明けに残りを済ませてから本社へ戻る', () => {
    // 11:40着・荷下ろし45分→13:25出発→13:55本社着
    expectTime(estimateReturnToDepotTime(depot, northKm(15), jst('11:40'), lunch, 45), jst('13:55'));
  });

  it('本社へ戻る途中で昼休みに入ったら、休憩明けに残りを走る', () => {
    // 11:30着→11:40出発→20分走って昼休み→13:00から残り10分→13:10
    expectTime(estimateReturnToDepotTime(depot, northKm(15), jst('11:30'), lunch), jst('13:10'));
  });
});

describe('nearestNeighborOrder（近い順に回る）', () => {
  it('現在地から最も近い地点を順に選ぶ', () => {
    const a = { id: 'a', ...northKm(30) };
    const b = { id: 'b', ...northKm(10) };
    const c = { id: 'c', ...northKm(20) };
    expect(nearestNeighborOrder(depot, [a, b, c]).map(s => s.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('orderWithTimeBudget（到着希望時刻を守りつつ順番を決める）', () => {
  it('到着希望時刻がなければ近い順', () => {
    const far = { id: 'far', ...northKm(30), arrivalTime: null };
    const near = { id: 'near', ...northKm(10), arrivalTime: null };
    expect(orderWithTimeBudget(depot, jst('09:00'), [far, near]).map(s => s.id)).toEqual(['near', 'far']);
  });

  it('時刻指定先に余裕があれば、途中の配送先を先に回る', () => {
    const anchor = { id: 'anchor', ...northKm(15), arrivalTime: jst('11:00').toISOString() };
    const onTheWay = { id: 'onTheWay', ...northKm(5), arrivalTime: null };
    expect(orderWithTimeBudget(depot, jst('09:00'), [anchor, onTheWay]).map(s => s.id)).toEqual(['onTheWay', 'anchor']);
  });

  it('時刻指定先に余裕がなければ、他の配送先は後回しにする', () => {
    // 本社から指定先まで直行でちょうど30分＝寄り道する余裕がない
    const anchor = { id: 'anchor', ...northKm(15), arrivalTime: jst('09:30').toISOString() };
    const other = { id: 'other', ...eastKm(5), arrivalTime: null };
    expect(orderWithTimeBudget(depot, jst('09:00'), [anchor, other]).map(s => s.id)).toEqual(['anchor', 'other']);
  });
});

describe('travelTimeMs（移動時間の見積もり・補正つき）', () => {
  // 1区間8分＋直線距離×1.2÷時速45km。真北15kmなら 8 + 15×1.2÷45×60 = 8 + 24 = 32分
  const travel: TravelModel = { averageSpeedKmh: 45, detourFactor: 1.2, perLegMinutes: 8 };
  const minutes = (ms: number) => Math.round(ms / 60000);

  it('補正を指定しなければ、従来どおり直線距離÷時速30km', () => {
    expect(minutes(travelTimeMs(depot, northKm(15)))).toBe(30);
  });

  it('1区間ごとの固定時間＋直線距離×回り道係数÷平均時速で見積もる', () => {
    expect(minutes(travelTimeMs(depot, northKm(15), travel))).toBe(32);
  });

  it('同じ場所への移動は、固定時間も足さず0分', () => {
    expect(travelTimeMs(northKm(15), northKm(15), travel)).toBe(0);
  });

  it('市街地の短い区間（直線1km）でも、固定時間の分だけ長く見積もる', () => {
    // 補正なしは2分。補正ありは 8 + 1×1.2÷45×60 = 9.6分
    expect(minutes(travelTimeMs(depot, northKm(1)))).toBe(2);
    expect(minutes(travelTimeMs(depot, northKm(1), travel))).toBe(10);
  });

  it('到着予定時刻・本社帰着予定にも補正が効く', () => {
    const timed = estimateStopTimes(depot, jst('09:00'), [{ ...northKm(15), arrivalTime: null }], undefined, 10, travel);
    expectTime(timed[0].estimatedTime, jst('09:32'));
    // 09:32着＋荷下ろし10分＝09:42発、本社まで32分で10:14着
    expectTime(estimateReturnToDepotTime(depot, northKm(15), jst('09:32'), undefined, 10, travel), jst('10:14'));
  });
});
