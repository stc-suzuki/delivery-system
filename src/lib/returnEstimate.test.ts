import { describe, expect, it } from 'vitest';
import type { Coord } from './routeOptimizer';
import { estimateReturnEta } from './returnEstimate';

// 本社の真北に配送先を置き、「15km＝平均時速30kmでちょうど30分」で手計算できる形にする
const KM_PER_DEGREE = (6371 * Math.PI) / 180;
const depot: Coord = { lat: 36.5657, lng: 139.8836 };
const northKm = (km: number): Coord => ({ lat: depot.lat + km / KM_PER_DEGREE, lng: depot.lng });
const jst = (hhmm: string) => new Date(`2026-10-15T${hhmm}:00+09:00`);
const options = { depot, lunchBreakStart: '12:00', lunchBreakEnd: '13:00', stopDurationMinutes: 45 };

function expectTime(actual: Date | null, expected: Date) {
  expect(actual).not.toBeNull();
  expect(Math.abs(actual!.getTime() - expected.getTime())).toBeLessThan(1000);
}

describe('estimateReturnEta（帰社途中のルートの本社帰着見込み）', () => {
  it('最後に完了した配送先の完了時刻から本社までの移動時間で求める（荷下ろし時間は足さない）', () => {
    const eta = estimateReturnEta(
      [
        { ...northKm(15), arrivedAt: jst('15:10'), scheduledTime: jst('14:00') },
        { ...northKm(30), arrivedAt: jst('14:20'), scheduledTime: jst('15:00') },
      ],
      options
    );
    // 予定（scheduledTime）が後の30km地点ではなく、実際に最後に完了した15km地点から30分
    expectTime(eta, jst('15:40'));
  });

  it('本社へ戻る途中で昼休みに入れば、その分だけ遅れる', () => {
    const eta = estimateReturnEta([{ ...northKm(15), arrivedAt: jst('11:50'), scheduledTime: null }], options);
    // 11:50発・30分の移動のうち10分走ったところで昼休み（1時間）→ 13:20着
    expectTime(eta, jst('13:20'));
  });

  it('完了の実績が無ければ、予定が最も遅い配送先の予定時刻＋荷下ろし時間から求める', () => {
    const eta = estimateReturnEta(
      [
        { ...northKm(15), arrivedAt: null, scheduledTime: jst('14:00') },
        { ...northKm(30), arrivedAt: null, scheduledTime: jst('15:00') },
      ],
      options
    );
    // 15:00着・荷下ろし45分・30kmを60分 → 16:45
    expectTime(eta, jst('16:45'));
  });

  it('配送先が無ければnull', () => {
    expect(estimateReturnEta([], options)).toBeNull();
  });
});
