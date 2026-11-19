import { describe, expect, it } from 'vitest';
import { attentionScore, AttentionStop } from './attentionScore';

const now = new Date('2026-11-19T15:20:00+09:00');
const at = (hhmm: string) => new Date(`2026-11-19T${hhmm}:00+09:00`);

const fixed = (hhmm: string, status = 'PENDING'): AttentionStop => ({
  status,
  isTimeFixed: true,
  requestedArrivalTime: at(hhmm),
});
const windowStop = (endHhmm: string, status = 'PENDING'): AttentionStop => ({
  status,
  isTimeFixed: false,
  requestedArrivalTime: null,
  requestedWindowEnd: at(endHhmm),
});
const plain: AttentionStop = { status: 'PENDING', isTimeFixed: false, requestedArrivalTime: null };

const route = (stops: AttentionStop[], extra: Partial<Parameters<typeof attentionScore>[0]> = {}) => ({
  operationStatus: 'IN_OPERATION' as const,
  departureTime: at('08:00'),
  stops,
  ...extra,
});

describe('attentionScore（要注意順の点数）', () => {
  it('時刻指定の時刻を過ぎた未完了は1件1点', () => {
    expect(attentionScore(route([fixed('14:00'), fixed('15:00'), fixed('16:00')]), now)).toBe(2);
  });

  it('時間帯の終わりを過ぎた未完了は1件0.5点', () => {
    expect(attentionScore(route([windowStop('15:00'), windowStop('12:00')]), now)).toBe(1);
  });

  it('時間帯の終わりがまだ先・完了済み・時間の条件なしは数えない', () => {
    expect(attentionScore(route([windowStop('17:00'), windowStop('15:00', 'COMPLETED'), plain]), now)).toBe(0);
  });

  it('時間帯の終わりを過ぎた未完了は、時刻指定の遅れより下・問題のないルートより上に並ぶ', () => {
    const late = attentionScore(route([fixed('14:00')]), now);
    const windowLate = attentionScore(route([windowStop('15:00')]), now);
    const ok = attentionScore(route([plain]), now);
    expect(late).toBeGreaterThan(windowLate);
    expect(windowLate).toBeGreaterThan(ok);
  });

  it('出発時刻を過ぎても稼働前なら2点', () => {
    expect(attentionScore(route([], { operationStatus: 'BEFORE_START' }), now)).toBe(2);
    expect(attentionScore(route([], { operationStatus: 'BEFORE_START', departureTime: at('16:00') }), now)).toBe(0);
  });

  it('日時を文字列で渡しても同じに数える', () => {
    const s: AttentionStop = { status: 'PENDING', isTimeFixed: false, requestedArrivalTime: null, requestedWindowEnd: at('15:00').toISOString() };
    expect(attentionScore(route([s], { departureTime: at('08:00').toISOString() }), now)).toBe(0.5);
  });
});
