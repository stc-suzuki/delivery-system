export type Coord = { lat: number; lng: number };

export function haversine(a: Coord, b: Coord): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
    Math.cos((b.lat * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// 地点aから見た地点bの方位角（0〜360度、真北=0、時計回り）。AI提案のスイープ法（方位角順に
// 停車地を処理し、同じ方面をなるべく1台にまとめる）で、本社からの方位角を求めるのに使う
export function bearingDeg(a: Coord, b: Coord): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

export function nearestNeighborOrder<T extends Coord>(depot: Coord, stops: T[]): T[] {
  const unvisited = [...stops];
  const route: T[] = [];
  let current: Coord = depot;
  while (unvisited.length) {
    let bestIdx = 0, minD = Infinity;
    unvisited.forEach((s, i) => {
      const d = haversine(current, s);
      if (d < minD) { minD = d; bestIdx = i; }
    });
    current = unvisited[bestIdx];
    route.push(...unvisited.splice(bestIdx, 1));
  }
  return route;
}

// 平均走行速度（km/h）と1停車あたりの作業時間（分）の目安値
export const AVERAGE_SPEED_KMH = 30;
export const STOP_DURATION_MINUTES = 10;

// 移動時間の見積もり方（システム設定で調整する）。道路を使った経路計算はしておらず、
// 「1区間ごとの固定時間 ＋ 直線距離×回り道係数÷平均時速」で近似する。固定時間は信号・右左折・
// 駐車などで、市街地の短い区間ほど直線距離だけでは短く見積もりすぎるのを補う（2026-10-20導入。
// それまでは直線距離÷時速30kmのみ＝DEFAULT_TRAVEL_MODELと同じ）
export interface TravelModel {
  /** 平均時速（km/h） */
  averageSpeedKmh: number;
  /** 回り道係数（道路の距離÷直線距離の目安） */
  detourFactor: number;
  /** 1区間ごとに足す固定時間（分） */
  perLegMinutes: number;
}

export const DEFAULT_TRAVEL_MODEL: TravelModel = { averageSpeedKmh: AVERAGE_SPEED_KMH, detourFactor: 1, perLegMinutes: 0 };

export function travelModelFromSettings(settings: {
  averageSpeedKmh: number;
  roadDetourFactor: number;
  perLegTravelMinutes: number;
}): TravelModel {
  return {
    averageSpeedKmh: settings.averageSpeedKmh,
    detourFactor: settings.roadDetourFactor,
    perLegMinutes: settings.perLegTravelMinutes,
  };
}

// 同じ場所（分割した停車地など、距離0）への移動は固定時間も足さず0とする
export function travelTimeMs(a: Coord, b: Coord, travel: TravelModel = DEFAULT_TRAVEL_MODEL): number {
  const km = haversine(a, b);
  if (km === 0) return 0;
  const minutes = travel.perLegMinutes + ((km * travel.detourFactor) / travel.averageSpeedKmh) * 60;
  return minutes * 60 * 1000;
}

const travelMs = travelTimeMs;

const DWELL_MS = STOP_DURATION_MINUTES * 60 * 1000;

export type LunchBreak = { start: Date; end: Date };

// 指定時刻が昼休み時間帯にかかっていれば、休憩明けの時刻まで繰り下げる
export function skipLunchBreak(time: Date, lunchBreak?: LunchBreak): Date {
  if (!lunchBreak) return time;
  if (time.getTime() >= lunchBreak.start.getTime() && time.getTime() < lunchBreak.end.getTime()) {
    return lunchBreak.end;
  }
  return time;
}

// 開始時刻に所要時間（運転・荷下ろし・積み込み）を足した終了時刻。昼休みは運転も作業も
// 止めて休む（2026-10-14決定）ため、途中で昼休みに入る場合は昼休みの長さだけ終了を遅らせる。
// 昼休み中に始めようとした場合は休憩明けに始める。終了がちょうど昼休み開始の時刻になる場合は
// 遅らせない（次の運転・作業を始める時点で、この関数またはskipLunchBreakが休憩明けに繰り下げる）
export function addTimeOutsideLunch(start: Date, durationMs: number, lunchBreak?: LunchBreak): Date {
  if (!lunchBreak) return new Date(start.getTime() + durationMs);
  const begin = skipLunchBreak(start, lunchBreak).getTime();
  const end = begin + durationMs;
  const lunchStart = lunchBreak.start.getTime();
  if (begin < lunchStart && end > lunchStart) {
    return new Date(end + (lunchBreak.end.getTime() - lunchStart));
  }
  return new Date(end);
}

// 停車地の到着の条件。arrivalTime＝時間指定（その時刻ちょうど）、windowStart/windowEnd＝時間帯
// （その中に着けばよい目安。2026-11-16導入）。どちらか一方だけを持つ
export interface ArrivalConstraint {
  arrivalTime?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
}

export interface ArrivalWindow {
  start: number;
  end: number;
  /** 時間指定（ちょうど）ならtrue。時間帯ならfalse */
  exact: boolean;
}

export function arrivalWindowOf(s: ArrivalConstraint): ArrivalWindow | null {
  if (s.arrivalTime) {
    const t = new Date(s.arrivalTime).getTime();
    return { start: t, end: t, exact: true };
  }
  if (s.windowStart && s.windowEnd) {
    return { start: new Date(s.windowStart).getTime(), end: new Date(s.windowEnd).getTime(), exact: false };
  }
  return null;
}

// 着いた時刻から、実際に荷下ろしを始める時刻（＝到着予定として扱う時刻）を求める。時間指定は指定の時刻まで、
// 時間帯は始まりまで待つ（始まりが昼休み中なら休憩明けまで）。条件がない・既に過ぎていれば着いた時刻のまま
export function serviceStartAt(arrival: Date, w: ArrivalWindow | null, lunchBreak?: LunchBreak): Date {
  if (!w || arrival.getTime() >= w.start) return arrival;
  if (w.exact) return new Date(w.start);
  return skipLunchBreak(new Date(w.start), lunchBreak);
}

// 並び順を決める。時間帯（目安）の停車地があればorderWithWindows、なければ従来の方法：
// 到着希望時刻が指定された地点は「その時刻までに着けばよい」制約として扱い、
// 直前の到着（または出発）からその制約時刻までの余裕時間がある限り、近くの
// 時刻未指定地点を経由させる。余裕がなくなった時点でその地点群への挿入を止め、
// 残りは次の制約区間（または最後の制約後）に回す。
export function orderWithTimeBudget<T extends Coord & ArrivalConstraint>(
  depot: Coord,
  departureTime: Date,
  stops: T[],
  lunchBreak?: LunchBreak,
  travel: TravelModel = DEFAULT_TRAVEL_MODEL
): T[] {
  if (stops.some(s => !s.arrivalTime && s.windowStart && s.windowEnd)) {
    return orderWithWindows(depot, departureTime, stops, lunchBreak, travel);
  }
  const timed = stops
    .filter(s => s.arrivalTime)
    .sort((a, b) => new Date(a.arrivalTime as string).getTime() - new Date(b.arrivalTime as string).getTime());
  const pool = stops.filter(s => !s.arrivalTime);

  if (timed.length === 0) return nearestNeighborOrder(depot, pool);

  const order: T[] = [];
  let currentPos: Coord = depot;
  let currentTime = departureTime.getTime();

  for (const anchor of timed) {
    const deadline = new Date(anchor.arrivalTime as string).getTime();

    // 余裕がある限り、現在地から最も近く・かつ制約時刻に間に合う未指定地点を順に追加
    while (pool.length > 0) {
      const sorted = pool
        .map((s, i) => ({ stop: s, index: i, dist: haversine(currentPos, s) }))
        .sort((a, b) => a.dist - b.dist);

      const feasible = sorted.find(({ stop }) => {
        const arrivalAtStop = skipLunchBreak(addTimeOutsideLunch(new Date(currentTime), travelMs(currentPos, stop, travel), lunchBreak), lunchBreak).getTime();
        const departAfterStop = addTimeOutsideLunch(new Date(arrivalAtStop), DWELL_MS, lunchBreak);
        const projectedAtAnchor = addTimeOutsideLunch(departAfterStop, travelMs(stop, anchor, travel), lunchBreak).getTime();
        return projectedAtAnchor <= deadline;
      });

      if (!feasible) break;

      order.push(feasible.stop);
      pool.splice(feasible.index, 1);
      const arrivalAtFeasible = skipLunchBreak(addTimeOutsideLunch(new Date(currentTime), travelMs(currentPos, feasible.stop, travel), lunchBreak), lunchBreak);
      currentTime = addTimeOutsideLunch(arrivalAtFeasible, DWELL_MS, lunchBreak).getTime();
      currentPos = feasible.stop;
    }

    order.push(anchor);
    currentPos = anchor;
    currentTime = addTimeOutsideLunch(new Date(deadline), DWELL_MS, lunchBreak).getTime();
  }

  if (pool.length > 0) {
    order.push(...nearestNeighborOrder(currentPos, pool));
  }

  return order;
}

// 時間帯（目安）の停車地を含む並び順（2026-11-16導入）。今いる場所・時刻から、次の候補を
// 次の優先順で1件ずつ選ぶ貪欲法（最適解の保証はない）：
//  1. その停車地に寄ると、今ならまだ間に合う時間指定（ちょうど）の停車地に間に合わなくなる件数が少ない
//  2. 同じく、今ならまだ間に合う時間帯の停車地に間に合わなくなる件数が少ない
//  3. 荷下ろしを始められる時刻が早い（時間帯の始まり前に着くなら待ち時間込み）。早い時間帯・近い停車地が先に来る
// 時間指定を時間帯より先に比べるのは、時間指定（約束）を時間帯（目安）より優先して守るため（2026-11-16決定）。
// 「間に合わなくなるか」は寄った後に直接向かった場合で見る（必要条件だけの簡易な判定）
function orderWithWindows<T extends Coord & ArrivalConstraint>(
  depot: Coord,
  departureTime: Date,
  stops: T[],
  lunchBreak: LunchBreak | undefined,
  travel: TravelModel
): T[] {
  const windowByStop = new Map<T, ArrivalWindow | null>(stops.map(s => [s, arrivalWindowOf(s)]));
  const arriveAt = (from: Coord, t: Date, to: Coord) =>
    skipLunchBreak(addTimeOutsideLunch(t, travelMs(from, to, travel), lunchBreak), lunchBreak);

  const remaining = [...stops];
  const order: T[] = [];
  let pos: Coord = depot;
  let time = departureTime;

  while (remaining.length > 0) {
    const savable = remaining.filter(s => {
      const w = windowByStop.get(s);
      return !!w && arriveAt(pos, time, s).getTime() <= w.end;
    });

    let best: { stop: T; lostExact: number; lostBand: number; start: number; leave: Date } | null = null;
    for (const s of remaining) {
      const start = serviceStartAt(arriveAt(pos, time, s), windowByStop.get(s) ?? null, lunchBreak);
      const leave = addTimeOutsideLunch(start, DWELL_MS, lunchBreak);
      let lostExact = 0;
      let lostBand = 0;
      for (const o of savable) {
        if (o === s) continue;
        const ow = windowByStop.get(o)!;
        if (arriveAt(s, leave, o).getTime() > ow.end) {
          if (ow.exact) lostExact++;
          else lostBand++;
        }
      }
      const cand = { stop: s, lostExact, lostBand, start: start.getTime(), leave };
      if (
        !best ||
        cand.lostExact < best.lostExact ||
        (cand.lostExact === best.lostExact && cand.lostBand < best.lostBand) ||
        (cand.lostExact === best.lostExact && cand.lostBand === best.lostBand && cand.start < best.start)
      ) {
        best = cand;
      }
    }

    order.push(best!.stop);
    remaining.splice(remaining.indexOf(best!.stop), 1);
    pos = best!.stop;
    time = best!.leave;
  }

  return order;
}

export type StopTimeEstimate<T> = T & { estimatedTime: Date; timeConflict: boolean };

// 出発時刻からの移動時間（直線距離÷平均速度）を積算して各停車地の到着予定時刻を推定する。
// 到着希望時刻が指定されている場合はその時刻を優先するが、直前の停車地からの移動時間で
// 間に合わない場合は到達可能な最短時刻にフォールバックし timeConflict を立てる。
// 時間帯（目安）の場合は、始まりより早く着くなら始まりまで待ち、終わりを過ぎて着くならtimeConflictを立てる
export function estimateStopTimes<T extends Coord & ArrivalConstraint>(
  depot: Coord,
  departureTime: Date,
  orderedStops: T[],
  lunchBreak?: LunchBreak,
  stopDurationMinutes: number = STOP_DURATION_MINUTES,
  travel: TravelModel = DEFAULT_TRAVEL_MODEL
): StopTimeEstimate<T>[] {
  let currentTime = departureTime;
  let currentPos: Coord = depot;
  const dwellMs = stopDurationMinutes * 60 * 1000;
  const result: StopTimeEstimate<T>[] = [];

  for (const stop of orderedStops) {
    const earliestArrival = skipLunchBreak(addTimeOutsideLunch(currentTime, travelMs(currentPos, stop, travel), lunchBreak), lunchBreak);

    // 時間指定は従来どおり：指定より早く着けば指定の時刻、遅れれば最短の時刻で矛盾あり
    const w = arrivalWindowOf(stop);
    const actualTime = serviceStartAt(earliestArrival, w, lunchBreak);
    const timeConflict = !!w && earliestArrival.getTime() > w.end;

    result.push({ ...stop, estimatedTime: actualTime, timeConflict });
    currentTime = addTimeOutsideLunch(actualTime, dwellMs, lunchBreak);
    currentPos = stop;
  }

  return result;
}

// 最後の配送先での荷下ろし完了後、本社へ戻り終える時刻を推定する。estimateStopTimesの
// 各レッグと同じ「荷下ろし後→昼休みチェック→移動→昼休みチェック」という手順を、本社を
// 次の目的地とみなして適用する（従来はこの帰還レッグにだけ昼休みが考慮されておらず、
// 昼休みにかかっていても遅延なしとして計算されていた）
export function estimateReturnToDepotTime(
  depot: Coord,
  lastStop: Coord,
  lastStopArrivalTime: Date,
  lunchBreak?: LunchBreak,
  stopDurationMinutes: number = STOP_DURATION_MINUTES,
  travel: TravelModel = DEFAULT_TRAVEL_MODEL
): Date {
  const departFromLastStop = addTimeOutsideLunch(lastStopArrivalTime, stopDurationMinutes * 60 * 1000, lunchBreak);
  return skipLunchBreak(addTimeOutsideLunch(departFromLastStop, travelMs(lastStop, depot, travel), lunchBreak), lunchBreak);
}

export const TOCHIGI_DEPOT: Coord = { lat: 36.5657, lng: 139.8836 };
