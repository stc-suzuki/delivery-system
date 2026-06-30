type Coord = { lat: number; lng: number };

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

export function clusterLocations<T extends Coord>(locations: T[], k: number): T[][] {
  let centroids: Coord[] = locations
    .slice()
    .sort(() => Math.random() - 0.5)
    .slice(0, k)
    .map(l => ({ lat: l.lat, lng: l.lng }));

  let assignments = new Array(locations.length).fill(0);

  for (let iter = 0; iter < 100; iter++) {
    const next = locations.map(loc => {
      let best = 0, minD = Infinity;
      centroids.forEach((c, i) => {
        const d = haversine(loc, c);
        if (d < minD) { minD = d; best = i; }
      });
      return best;
    });
    if (next.every((v, i) => v === assignments[i])) break;
    assignments = next;
    centroids = centroids.map((_, i) => {
      const group = locations.filter((_, j) => assignments[j] === i);
      if (!group.length) return centroids[i];
      return {
        lat: group.reduce((s, l) => s + l.lat, 0) / group.length,
        lng: group.reduce((s, l) => s + l.lng, 0) / group.length,
      };
    });
  }

  return centroids.map((_, i) => locations.filter((_, j) => assignments[j] === i));
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

function travelMs(a: Coord, b: Coord): number {
  return (haversine(a, b) / AVERAGE_SPEED_KMH) * 60 * 60 * 1000;
}

const DWELL_MS = STOP_DURATION_MINUTES * 60 * 1000;

export type LunchBreak = { start: Date; end: Date };

// 指定時刻が昼休み時間帯にかかっていれば、休憩明けの時刻まで繰り下げる
function skipLunchBreak(time: Date, lunchBreak?: LunchBreak): Date {
  if (!lunchBreak) return time;
  if (time.getTime() >= lunchBreak.start.getTime() && time.getTime() < lunchBreak.end.getTime()) {
    return lunchBreak.end;
  }
  return time;
}

// 到着希望時刻が指定された地点は「その時刻までに着けばよい」制約として扱い、
// 直前の到着（または出発）からその制約時刻までの余裕時間がある限り、近くの
// 時刻未指定地点を経由させる。余裕がなくなった時点でその地点群への挿入を止め、
// 残りは次の制約区間（または最後の制約後）に回す。
export function orderWithTimeBudget<T extends Coord & { arrivalTime?: string | null }>(
  depot: Coord,
  departureTime: Date,
  stops: T[],
  lunchBreak?: LunchBreak
): T[] {
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
        const arrivalAtStop = skipLunchBreak(new Date(currentTime + travelMs(currentPos, stop)), lunchBreak).getTime();
        const departAfterStop = arrivalAtStop + DWELL_MS;
        const projectedAtAnchor = departAfterStop + travelMs(stop, anchor);
        return projectedAtAnchor <= deadline;
      });

      if (!feasible) break;

      order.push(feasible.stop);
      pool.splice(feasible.index, 1);
      currentTime = skipLunchBreak(new Date(currentTime + travelMs(currentPos, feasible.stop)), lunchBreak).getTime() + DWELL_MS;
      currentPos = feasible.stop;
    }

    order.push(anchor);
    currentPos = anchor;
    currentTime = deadline + DWELL_MS;
  }

  if (pool.length > 0) {
    order.push(...nearestNeighborOrder(currentPos, pool));
  }

  return order;
}

export type StopTimeEstimate<T> = T & { estimatedTime: Date; timeConflict: boolean };

// 出発時刻からの移動時間（直線距離÷平均速度）を積算して各停車地の到着予定時刻を推定する。
// 到着希望時刻が指定されている場合はその時刻を優先するが、直前の停車地からの移動時間で
// 間に合わない場合は到達可能な最短時刻にフォールバックし timeConflict を立てる。
export function estimateStopTimes<T extends Coord & { arrivalTime?: string | null }>(
  depot: Coord,
  departureTime: Date,
  orderedStops: T[],
  lunchBreak?: LunchBreak,
  stopDurationMinutes: number = STOP_DURATION_MINUTES
): StopTimeEstimate<T>[] {
  let currentTime = departureTime;
  let currentPos: Coord = depot;
  const dwellMs = stopDurationMinutes * 60 * 1000;
  const result: StopTimeEstimate<T>[] = [];

  for (const stop of orderedStops) {
    const travelHours = haversine(currentPos, stop) / AVERAGE_SPEED_KMH;
    const earliestArrival = skipLunchBreak(new Date(currentTime.getTime() + travelHours * 60 * 60 * 1000), lunchBreak);

    let actualTime = earliestArrival;
    let timeConflict = false;
    if (stop.arrivalTime) {
      const requested = new Date(stop.arrivalTime);
      if (requested.getTime() < earliestArrival.getTime()) {
        timeConflict = true;
      } else {
        actualTime = requested;
      }
    }

    result.push({ ...stop, estimatedTime: actualTime, timeConflict });
    currentTime = skipLunchBreak(new Date(actualTime.getTime() + dwellMs), lunchBreak);
    currentPos = stop;
  }

  return result;
}

export function routeDistance(depot: Coord, stops: Coord[]): number {
  let total = 0;
  let current = depot;
  for (const s of stops) {
    total += haversine(current, s);
    current = s;
  }
  return total;
}

export const TOCHIGI_DEPOT: Coord = { lat: 36.5657, lng: 139.8836 };
