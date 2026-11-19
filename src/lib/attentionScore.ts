import type { RouteOperationStatus } from './routeOperationStatus';

// 配送計画一覧・ダッシュボードの並べ替え「要注意順」の点数。画面には出さず、並び順だけに使う。
// ・出発時刻を過ぎても稼働前のまま：2点
// ・時刻指定の時刻を過ぎても未完了の配送先：1件ごとに1点
// ・時間帯（目安）の終わりを過ぎても未完了の配送先：1件ごとに0.5点（2026-11-19ユーザー決定。
//   時間帯は「その中に着けばよい」目安のため時刻指定の遅れより軽く扱うが、問題のないトラックよりは上に出す）
// 遅れの判定はお客様と約束した時刻（requestedArrivalTime・requestedWindowEnd）と比べる。
// 見込み時刻（scheduledTime）は移動時間の都合でずれるため使わない

export const LATE_FIXED_STOP_POINTS = 1;
export const LATE_WINDOW_STOP_POINTS = 0.5;
export const NOT_DEPARTED_POINTS = 2;

export type AttentionStop = {
  status: string;
  isTimeFixed: boolean;
  requestedArrivalTime: Date | string | null;
  requestedWindowEnd?: Date | string | null;
};

export type AttentionRoute = {
  operationStatus: RouteOperationStatus;
  departureTime: Date | string | null;
  stops: AttentionStop[];
};

const toTime = (d: Date | string) => new Date(d).getTime();

export function attentionScore(route: AttentionRoute, now: Date): number {
  const nowMs = now.getTime();
  let score = 0;
  if (route.operationStatus === 'BEFORE_START' && route.departureTime && toTime(route.departureTime) < nowMs) {
    score += NOT_DEPARTED_POINTS;
  }
  for (const s of route.stops) {
    if (s.status !== 'PENDING') continue;
    if (s.isTimeFixed && s.requestedArrivalTime) {
      if (toTime(s.requestedArrivalTime) < nowMs) score += LATE_FIXED_STOP_POINTS;
      continue;
    }
    if (s.requestedWindowEnd && toTime(s.requestedWindowEnd) < nowMs) score += LATE_WINDOW_STOP_POINTS;
  }
  return score;
}
