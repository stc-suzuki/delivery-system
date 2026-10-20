import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkTruckAvailable, checkDriverAvailable, checkDriverNotOnDayOff } from '@/lib/planValidation';
import { isDefaultDayOff } from '@/lib/driverSchedule';
import { reorderRoute } from '@/lib/routeReorder';

// 指定日のまだ稼働していない（PENDING）ルートの構成（使用するトラック・ドライバーの組み合わせ）を
// 一括で登録・変更する。新規作成（その日にまだPENDINGルートが1件もない状態から作る）・既存PENDING
// ルートのトラック構成変更のどちらもこのエンドポイントで行う（旧routes-setupをplanId単位から日付単位に置き換え）。
// 稼働中・完了済みルートはこのエンドポイントの対象外（他画面で個別に変更する）。
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const body = await req.json();
    const { date, trucks, departureTime } = body as {
      date: string;
      trucks: { truckId: string; driverId: string }[];
      departureTime?: string;
    };

    if (!date) {
      return NextResponse.json({ error: 'date は必須です' }, { status: 400 });
    }
    if (!Array.isArray(trucks)) {
      return NextResponse.json({ error: 'trucks は配列で指定してください' }, { status: 400 });
    }
    if (trucks.length > 15) {
      return NextResponse.json({ error: 'トラックは最大15台までです' }, { status: 400 });
    }
    if (departureTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(departureTime)) {
      return NextResponse.json({ error: '出発時間はHH:mm形式で指定してください' }, { status: 400 });
    }

    // trucks が空配列＝登録済みトラックを全て解除する意図のリクエストなので、土日祝日の
    // 配送除外チェック（新規登録の防止が目的）は対象外とする
    const systemSetting = await prisma.systemSetting.findUnique({ where: { id: 'default' } });
    if (trucks.length > 0 && systemSetting?.excludeWeekendsAndHolidays && isDefaultDayOff(new Date(date))) {
      return NextResponse.json({ error: 'この日は土日祝日のため配送除外日です。トラックは登録できません' }, { status: 400 });
    }

    // ドライバーの重複チェック（同一リクエスト内）。checkDriverAvailableはDB上の既存ルートとしか
    // 比較しないため、新規作成時に同じドライバーを複数のトラックへ同時に設定すると
    // どちらの個別チェックも「空き」と判定されすり抜けてしまう。ここで先に弾く
    const driverIdCounts = new Map<string, number>();
    for (const t of trucks) {
      if (!t.driverId) continue;
      driverIdCounts.set(t.driverId, (driverIdCounts.get(t.driverId) ?? 0) + 1);
    }
    const duplicateDriverId = Array.from(driverIdCounts.entries()).find(([, count]) => count > 1)?.[0];
    if (duplicateDriverId) {
      const driver = await prisma.driver.findUnique({ where: { id: duplicateDriverId } });
      return NextResponse.json(
        { error: `ドライバー ${driver?.name ?? duplicateDriverId} が複数のトラックに重複して設定されています` },
        { status: 400 }
      );
    }

    const routeDate = new Date(date);
    let departureDateTime: Date | undefined;
    if (departureTime !== undefined) {
      const [h, m] = departureTime.split(':').map(Number);
      departureDateTime = new Date(routeDate);
      departureDateTime.setHours(h, m, 0, 0);
    }

    const existingPendingRoutes = await prisma.planRoute.findMany({
      where: { routeDate, status: 'PENDING' },
      include: { stops: true },
    });

    const requestedTruckIds = new Set(trucks.map(t => t.truckId));
    const toRemove = existingPendingRoutes.filter(r => !requestedTruckIds.has(r.truckId));

    const existingByTruckId = new Map(existingPendingRoutes.map(r => [r.truckId, r]));
    for (const t of trucks) {
      const excludeRouteId = existingByTruckId.get(t.truckId)?.id;
      const truckOk = await checkTruckAvailable(routeDate, t.truckId, excludeRouteId);
      if (!truckOk) {
        const truck = await prisma.truck.findUnique({ where: { id: t.truckId } });
        return NextResponse.json({ error: `トラック ${truck?.plateNo ?? t.truckId} は同日に既に割り当てられています` }, { status: 400 });
      }
      const driverOk = await checkDriverAvailable(routeDate, t.driverId, excludeRouteId);
      if (!driverOk) {
        const driver = await prisma.driver.findUnique({ where: { id: t.driverId } });
        return NextResponse.json({ error: `ドライバー ${driver?.name ?? t.driverId} は同日に既に割り当てられています` }, { status: 400 });
      }
      const dayOffOk = await checkDriverNotOnDayOff(routeDate, t.driverId);
      if (!dayOffOk) {
        const driver = await prisma.driver.findUnique({ where: { id: t.driverId } });
        return NextResponse.json({ error: `ドライバー ${driver?.name ?? t.driverId} は当日休日として設定されているため、割り当てられません` }, { status: 400 });
      }
    }

    const createdBy = session?.user?.email ?? 'unknown';

    const routeIds = await prisma.$transaction(async tx => {
      if (toRemove.length > 0) {
        // 荷物データ自体は消さずプールへ解放してからルートを削除する（/api/plans/[id] DELETEと同じ方針）
        await tx.deliveryStop.updateMany({
          where: { routeId: { in: toRemove.map(r => r.id) } },
          data: { routeId: null, tripId: null },
        });
        await tx.trackingLog.deleteMany({ where: { routeId: { in: toRemove.map(r => r.id) } } });
        await tx.fuelLog.deleteMany({ where: { routeId: { in: toRemove.map(r => r.id) } } });
        // RouteTrip.routeIdはON DELETE RESTRICTのため、ルート削除前に便を先に消す必要がある
        await tx.routeTrip.deleteMany({ where: { routeId: { in: toRemove.map(r => r.id) } } });
        await tx.planRoute.deleteMany({ where: { id: { in: toRemove.map(r => r.id) } } });
      }
      const ids: string[] = [];
      for (let i = 0; i < trucks.length; i++) {
        const t = trucks[i];
        const existing = existingByTruckId.get(t.truckId);
        if (existing) {
          await tx.planRoute.update({
            where: { id: existing.id },
            data: {
              driverId: t.driverId,
              sortOrder: i,
              ...(departureDateTime !== undefined && { departureTime: departureDateTime }),
            },
          });
          // 出発時刻を変えた場合、割当済みの配送先の到着予定（scheduledTime）は割当時に保存した値のままなので、
          // 新しい出発時刻で計算し直す（しないとガントチャート・ドライバー画面に古い時刻が残る）
          const departureChanged =
            departureDateTime !== undefined && existing.departureTime?.getTime() !== departureDateTime.getTime();
          if (departureChanged && existing.stops.length > 0) {
            await reorderRoute(tx, existing.id);
          }
          ids.push(existing.id);
        } else {
          const created = await tx.planRoute.create({
            data: {
              truckId: t.truckId,
              driverId: t.driverId,
              routeDate,
              createdBy,
              sortOrder: i,
              departureTime: departureDateTime,
            },
          });
          // ルートは常に便を1件以上持つ不変条件のため、作成と同時に便0を作る
          await tx.routeTrip.create({ data: { routeId: created.id, tripIndex: 0 } });
          ids.push(created.id);
        }
      }
      return ids;
    });

    const routes = await prisma.planRoute.findMany({
      where: { id: { in: routeIds } },
      orderBy: { sortOrder: 'asc' },
      include: {
        truck: true,
        driver: true,
        stops: { include: { location: true, packages: true } },
        trips: { orderBy: { tripIndex: 'asc' } },
      },
    });

    return NextResponse.json({ routes });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'トラック構成の更新に失敗しました' }, { status: 500 });
  }
}
