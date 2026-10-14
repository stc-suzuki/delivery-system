import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getIO } from '@/lib/socket';
import { checkDriverAccess } from '@/lib/driverAccess';

// PATCH: 停車地のステータス更新（COMPLETED / SKIPPED）
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { status, actor } = body;
    if (!['COMPLETED', 'SKIPPED', 'PENDING'].includes(status)) {
      return NextResponse.json({ error: 'status の値が不正です' }, { status: 400 });
    }

    // 有効期限の確認のため、更新より前に所属ルートの配送日を調べる
    const target = await prisma.deliveryStop.findUnique({
      where: { id: params.id },
      select: { route: { select: { routeDate: true } } },
    });
    if (!target) {
      return NextResponse.json({ error: '対象の停車地が見つかりません（配送ルートが削除された可能性があります）' }, { status: 404 });
    }
    if (!target.route) {
      return NextResponse.json({ error: 'この停車地はまだトラックに割り当てられていません' }, { status: 400 });
    }
    const { loggedIn, denied } = await checkDriverAccess(req, target.route.routeDate);
    if (denied) return denied;

    const stop = await prisma.deliveryStop.update({
      where: { id: params.id },
      data: {
        status,
        arrivedAt: status === 'COMPLETED' ? new Date() : null,
        // ドライバーが押し忘れた場合に本部（リアルタイム追跡画面）が代理で操作したことを記録する。
        // actor省略時（ドライバー画面からの呼び出し）は従来通りfalseのまま。自己申告のため、ログイン済みの場合だけ認める
        statusSetByDispatcher: actor === 'DISPATCHER' && loggedIn,
      },
      include: { route: { include: { stops: true, trips: true } } },
    });

    const route = stop.route;
    if (!route) {
      return NextResponse.json({ error: 'この停車地はまだトラックに割り当てられていません' }, { status: 400 });
    }

    // 運送開始ボタンの押し忘れ対策: 未開始のまま最初の完了操作が行われたらルートを進行中にする
    if (status === 'COMPLETED' && route.status === 'PENDING') {
      await prisma.planRoute.update({
        where: { id: route.id },
        data: { status: 'IN_PROGRESS' },
      });
    }
    // 複数便対応フェーズ3：便を使うルートで、その停車地が属する便がまだ開始されていなければ
    // 同様に進行中にする（便の「N便を開始」ボタンの押し忘れ対策）
    if (status === 'COMPLETED' && stop.tripId) {
      const trip = route.trips.find(t => t.id === stop.tripId);
      if (trip && trip.status === 'PENDING') {
        await prisma.routeTrip.update({ where: { id: trip.id }, data: { status: 'IN_PROGRESS' } });
      }
    }

    const allStopsResolved =
      route.stops.length > 0 &&
      route.stops.every(s => s.status === 'COMPLETED' || s.status === 'SKIPPED');

    if (allStopsResolved && route.status !== 'COMPLETED') {
      await prisma.planRoute.update({
        where: { id: route.id },
        data: { status: 'COMPLETED' },
      });
      // 便を使うルートの場合、まだCOMPLETEDでない便（＝最後の便）も合わせて完了にする。
      // このタイミングは「その便の全停車地が今まさに解決済みになった瞬間」なので、returnedAtも
      // 併せて記録する（以前はstatusのみ更新しておりreturnedAtが空のままになるバグがあった。
      // ガントチャート上でこの便が実際には本社に戻っているのに「帰着予定」のまま表示され続ける
      // 原因になっていた）
      // ただし停車地が現在1件も無い便（＝未割当に戻す等で空になっただけの便）は対象外にする
      // （optimize/route.tsの同種の安全策と同じ理由。含めてしまうと一度も出発していない
      // 空の便まで「完了・帰社済み」扱いになり、次に配送先を追加した際に使い回されず
      // 新しい便が余分に作られ続けてしまう）
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
    io?.emit('tracking:stop-update', { stopId: stop.id, status: stop.status, routeId: route.id });

    return NextResponse.json(stop);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: '対象の停車地が見つかりません（配送ルートが削除された可能性があります）' }, { status: 404 });
    }
    console.error(error);
    return NextResponse.json({ error: '停車地の更新に失敗しました' }, { status: 500 });
  }
}
