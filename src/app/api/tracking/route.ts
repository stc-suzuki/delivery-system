import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getIO } from '@/lib/socket';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // tripId: 便を使うルートで、送信時点でドライバーが対応中の便のID（任意）。
    // 便を使わないルート・未指定時はnullのまま記録する
    const { routeId, lat, lng, tripId } = body;
    if (!routeId || typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json({ error: 'routeId, lat, lng は必須です' }, { status: 400 });
    }

    const route = await prisma.planRoute.findUnique({
      where: { id: routeId },
      include: { stops: true, trips: true },
    });
    if (!route) {
      return NextResponse.json({ error: 'ルートが見つかりません' }, { status: 404 });
    }

    const log = await prisma.trackingLog.create({
      data: { routeId, lat, lng, tripId: tripId ?? null },
    });

    // 初回ログでルートを進行中に更新
    if (route.status === 'PENDING') {
      await prisma.planRoute.update({
        where: { id: routeId },
        data: { status: 'IN_PROGRESS' },
      });
    }

    // 全停車地が完了/スキップならルート完了に更新
    const allStopsResolved =
      route.stops.length > 0 &&
      route.stops.every(s => s.status === 'COMPLETED' || s.status === 'SKIPPED');

    if (allStopsResolved && route.status !== 'COMPLETED') {
      await prisma.planRoute.update({
        where: { id: routeId },
        data: { status: 'COMPLETED' },
      });
      // 便を使うルートの場合、まだCOMPLETEDでない便（＝最後の便）も合わせて完了にする
      // （tracking/stops/[id]/route.tsのallStopsResolved処理と同じ安全策。GPSログの受信が
      // 配達完了操作より先にこの分岐へ到達した場合、ここで便の完了処理をしないと便だけが
      // 完了しないまま取り残されてしまうため、こちらにも同じ処理を持たせる）。停車地0件の
      // 空便は対象外にする（理由はtracking/stops/[id]/route.tsのコメント参照）
      const unfinishedTrips = route.trips.filter(
        t => t.status !== 'COMPLETED' && route.stops.some(s => s.tripId === t.id)
      );
      if (unfinishedTrips.length > 0) {
        await prisma.routeTrip.updateMany({
          where: { id: { in: unfinishedTrips.map(t => t.id) } },
          data: { status: 'COMPLETED', returnedAt: new Date() },
        });
      }
    }

    const io = getIO();
    io?.emit('tracking:update', { routeId, lat, lng, timestamp: log.timestamp });

    return NextResponse.json(log, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '追跡ログの登録に失敗しました' }, { status: 500 });
  }
}
