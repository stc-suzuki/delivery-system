// 出発済みのトラックの「今いる場所」を決める。稼働中ルートへの配送先追加（optimize/route.ts）と、
// 荷物受付の当日の見込み（/api/pool・/api/capacity-overview）の両方から使う。
import type { PrismaClient } from '@prisma/client';
import { Coord } from './routeOptimizer';

export interface PositionSources {
  /** 直近の便の帰社が記録済み（＝トラックは本社にいる） */
  atDepot: boolean;
  /** ドライバー画面から最後に送られてきた位置 */
  lastLog: Coord | null;
  /** 最後に配達完了を押した配送先（計画の順番ではなく、実際に完了した時刻が最も新しいもの） */
  lastCompletedStop: Coord | null;
}

// 優先順：帰社済みなら本社 > 最後に送られてきた位置 > 最後に配達完了を押した配送先 > 本社。
// 帰社の実績はGPS・配達完了地点より優先する（帰社済みなのにお客様先を現在地とみなし、そこから
// 本社までの移動時間を余計に足してしまうのを防ぐ）
export function resolveCurrentPosition(src: PositionSources, depot: Coord): Coord {
  if (src.atDepot) return depot;
  if (src.lastLog) return { lat: src.lastLog.lat, lng: src.lastLog.lng };
  if (src.lastCompletedStop) return { lat: src.lastCompletedStop.lat, lng: src.lastCompletedStop.lng };
  return depot;
}

// 複数ルートの今いる場所をまとめて取得する（ルートごとに3回問い合わせないよう、種類ごとに1回ずつ）
export async function fetchCurrentPositions(
  db: Pick<PrismaClient, 'routeTrip' | 'trackingLog' | 'deliveryStop'>,
  routeIds: string[],
  depot: Coord
): Promise<Map<string, Coord>> {
  if (routeIds.length === 0) return new Map();
  const [trips, logs, completed] = await Promise.all([
    db.routeTrip.findMany({
      where: { routeId: { in: routeIds } },
      orderBy: { tripIndex: 'desc' },
      distinct: ['routeId'],
      select: { routeId: true, returnedAt: true },
    }),
    db.trackingLog.findMany({
      where: { routeId: { in: routeIds } },
      orderBy: { timestamp: 'desc' },
      distinct: ['routeId'],
      select: { routeId: true, lat: true, lng: true },
    }),
    db.deliveryStop.findMany({
      where: { routeId: { in: routeIds }, status: 'COMPLETED', arrivedAt: { not: null } },
      orderBy: { arrivedAt: 'desc' },
      distinct: ['routeId'],
      select: { routeId: true, location: { select: { lat: true, lng: true } } },
    }),
  ]);
  const atDepot = new Set(trips.filter(t => t.returnedAt !== null).map(t => t.routeId));
  const logByRoute = new Map(logs.map(l => [l.routeId, { lat: l.lat, lng: l.lng }]));
  const stopByRoute = new Map(completed.map(s => [s.routeId as string, s.location]));
  return new Map(
    routeIds.map(id => [
      id,
      resolveCurrentPosition(
        { atDepot: atDepot.has(id), lastLog: logByRoute.get(id) ?? null, lastCompletedStop: stopByRoute.get(id) ?? null },
        depot
      ),
    ])
  );
}
