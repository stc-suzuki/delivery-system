import { estimateReturnToDepotTime, type Coord, type LunchBreak } from './routeOptimizer';

export type ReturnEstimateStop = {
  lat: number;
  lng: number;
  arrivedAt: Date | null;
  scheduledTime: Date | null;
};

// 昼休み開始・終了（HH:mm）を、指定した日付のDateとして解決する（optimize/route.tsと同じ考え方）
export function resolveLunchBreak(anchor: Date, lunchBreakStart: string, lunchBreakEnd: string): LunchBreak | undefined {
  const [startH, startM] = lunchBreakStart.split(':').map(Number);
  const [endH, endM] = lunchBreakEnd.split(':').map(Number);
  const start = new Date(anchor);
  start.setHours(startH, startM, 0, 0);
  const end = new Date(anchor);
  end.setHours(endH, endM, 0, 0);
  return end.getTime() > start.getTime() ? { start, end } : undefined;
}

// 配達をすべて終えて本社へ戻っている途中のルートについて、本社に着く見込みの時刻を求める。
// 最後に「完了」を押した配送先（arrivedAt＝荷下ろしまで済んだ実績時刻）から本社までの移動時間で計算し、
// 昼休みにかかれば休憩明けまで繰り下げる。完了の実績が1件も無い（全件スキップ等）場合は、
// 到着予定が最も遅い配送先の予定時刻＋荷下ろし時間から計算する（ガントチャートの帰社予定と同じ）
export function estimateReturnEta(
  stops: ReturnEstimateStop[],
  options: { depot: Coord; lunchBreakStart: string; lunchBreakEnd: string; stopDurationMinutes: number }
): Date | null {
  const latestBy = (key: 'arrivedAt' | 'scheduledTime') =>
    stops
      .filter(s => s[key] != null)
      .reduce<ReturnEstimateStop | null>((latest, s) => (!latest || s[key]! > latest[key]! ? s : latest), null);

  const completed = latestBy('arrivedAt');
  const base = completed ?? latestBy('scheduledTime');
  if (!base) return null;
  const startTime = completed ? completed.arrivedAt! : base.scheduledTime!;
  const lunchBreak = resolveLunchBreak(startTime, options.lunchBreakStart, options.lunchBreakEnd);
  // 実績（arrivedAt）は荷下ろしが済んだ時点の記録のため、荷下ろし時間は足さない
  return estimateReturnToDepotTime(options.depot, base, startTime, lunchBreak, completed ? 0 : options.stopDurationMinutes);
}
