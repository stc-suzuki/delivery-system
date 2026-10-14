// 複数便（1台のトラックが1日に何度も本社と往復する）対応・フェーズ1：便単位の時刻計算。
//
// 既存のrouteOptimizer.tsの関数（orderWithTimeBudget/estimateStopTimes/estimateReturnToDepotTime/
// addTimeOutsideLunch）は変更せず、これらを便ごとに繰り返し呼び出すことで
// 「本社→便1の各停車地→本社着→（積み込み）→本社発→便2の各停車地→本社着…」という
// 一連の時刻列を計算する。optimize/route.tsの「新規追加時は一旦本社に戻って積み直す」ロジック
// （現在は1回だけ発生する前提）と同じ考え方を、複数便に一般化したもの。

import {
  Coord,
  LunchBreak,
  StopTimeEstimate,
  STOP_DURATION_MINUTES,
  orderWithTimeBudget,
  estimateStopTimes,
  estimateReturnToDepotTime,
  addTimeOutsideLunch,
} from './routeOptimizer';

export interface TripTimeResult<T> {
  /** この便の出発時刻 */
  departureTime: Date;
  /** この便の各停車地の並び順・到着予定時刻 */
  stops: StopTimeEstimate<T>[];
  /** この便の本社帰着予定時刻。停車地が1件もない便は出発時刻と同じ */
  returnedAt: Date;
}

export interface PlanTripsResult<T> {
  trips: TripTimeResult<T>[];
}

/**
 * 複数便分の時刻列をまとめて計算する。
 * `firstDepartureTime`は1便目の出発時刻。2便目以降の出発時刻は、前の便の本社帰着予定
 * ＋積み込み時間（reloadDurationMinutes）から自動的に算出する（昼休み中は積み込みも止めて休むため、
 * 途中で昼休みに入れば休憩明けに残りを済ませる。optimize/route.tsの本社経由ロジックと同じ手順）。
 *
 * `tripsStops`は便ごとの停車地配列（各便内は未整列でよい。中でorderWithTimeBudgetにかける）。
 */
export function planTrips<T extends Coord & { arrivalTime?: string | null }>(
  depot: Coord,
  firstDepartureTime: Date,
  tripsStops: T[][],
  reloadDurationMinutes: number,
  lunchBreak?: LunchBreak,
  stopDurationMinutes: number = STOP_DURATION_MINUTES
): PlanTripsResult<T> {
  const trips: TripTimeResult<T>[] = [];
  let nextDepartureTime = firstDepartureTime;

  for (const stopsForTrip of tripsStops) {
    const ordered = orderWithTimeBudget(depot, nextDepartureTime, stopsForTrip, lunchBreak);
    const timed = estimateStopTimes(depot, nextDepartureTime, ordered, lunchBreak, stopDurationMinutes);
    const last = timed[timed.length - 1];
    const returnedAt = last
      ? estimateReturnToDepotTime(depot, last, last.estimatedTime, lunchBreak, stopDurationMinutes)
      : nextDepartureTime;

    trips.push({ departureTime: nextDepartureTime, stops: timed, returnedAt });

    // 次の便の出発時刻＝この便の本社帰着（＝本社到着）＋積み込み時間。積み込みの途中で
    // 昼休みに入れば作業を止め、休憩明けに残りを済ませる
    const reloadMs = reloadDurationMinutes * 60 * 1000;
    nextDepartureTime = addTimeOutsideLunch(returnedAt, reloadMs, lunchBreak);
  }

  return { trips };
}
