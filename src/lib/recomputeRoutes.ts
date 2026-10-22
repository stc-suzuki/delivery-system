// 割当時に保存した到着予定（scheduledTime）を、前提が変わったときにまとめて計算し直す。
// システム設定（移動時間の見積もり）と配送先の位置の変更から使う。
import { prisma } from './prisma';
import { reorderRoute } from './routeReorder';

// 今日（日本時間）以降の、まだ出発していない（PENDING）・配送先が割当済みのルートの到着予定を計算し直す。
// locationIdを指定すると、その配送先を含むルートだけが対象
export async function recomputePendingRoutesFromToday(locationId?: string): Promise<number> {
  const todayJst = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const routes = await prisma.planRoute.findMany({
    where: {
      status: 'PENDING',
      routeDate: { gte: new Date(`${todayJst}T00:00:00.000Z`) },
      stops: { some: locationId ? { locationId } : {} },
    },
    select: { id: true },
  });
  for (const r of routes) {
    await prisma.$transaction(tx => reorderRoute(tx, r.id));
  }
  return routes.length;
}
