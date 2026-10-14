import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { rescheduleFollowingTrips } from '@/lib/routeReorder';
import { checkDriverAccess } from '@/lib/driverAccess';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { routeId: string } }
) {
  try {
    const { status, markReturned, actor, completeTripId, startTripId } = await req.json();
    const existing = await prisma.planRoute.findUnique({
      where: { id: params.routeId },
      include: { trips: { orderBy: { tripIndex: 'asc' } } },
    });
    if (!existing) {
      return NextResponse.json({ error: '対象のルートが見つかりません（削除された可能性があります）' }, { status: 404 });
    }
    const { loggedIn, denied } = await checkDriverAccess(req, existing.routeDate);
    if (denied) return denied;
    // 本部（リアルタイム追跡画面）による代理操作の記録は、ログイン済みの場合だけ認める
    const isDispatcher = actor === 'DISPATCHER' && loggedIn;

    // 複数便対応フェーズ3：便の完了（本社へ）・開始
    if (completeTripId) {
      const trip = existing.trips.find(t => t.id === completeTripId);
      if (!trip) {
        return NextResponse.json({ error: '対象の便が見つかりません' }, { status: 404 });
      }
      if (trip.status === 'COMPLETED') {
        return NextResponse.json({ error: 'この便は既に完了しています' }, { status: 400 });
      }
      const unresolvedCount = await prisma.deliveryStop.count({
        where: { tripId: trip.id, status: 'PENDING' },
      });
      if (unresolvedCount > 0) {
        return NextResponse.json({ error: 'この便にはまだ未完了の配送先があります' }, { status: 400 });
      }
      const returnedAt = new Date();
      await prisma.$transaction(async tx => {
        await tx.routeTrip.update({
          where: { id: trip.id },
          data: { status: 'COMPLETED', returnedAt, returnedByDispatcher: isDispatcher },
        });
        // まだ開始していない後続の便は、実際の帰着時刻を起点に出発・到着予定時刻を計算し直す。
        // これをしないと後続便の時刻が計画時のまま残り、ガントチャート上で完了した便と時間的に
        // 重なって表示されてしまう（例：1便が遅れて戻ったのに2便の時刻は元の予定のまま）
        await rescheduleFollowingTrips(tx, params.routeId, trip.tripIndex, returnedAt);
      });
    } else if (startTripId) {
      const trip = existing.trips.find(t => t.id === startTripId);
      if (!trip) {
        return NextResponse.json({ error: '対象の便が見つかりません' }, { status: 404 });
      }
      if (trip.status !== 'PENDING') {
        return NextResponse.json({ error: 'この便は既に開始されています' }, { status: 400 });
      }
      const priorTrip = existing.trips.find(t => t.tripIndex === trip.tripIndex - 1);
      if (priorTrip && priorTrip.status !== 'COMPLETED') {
        return NextResponse.json({ error: '前の便が完了していません' }, { status: 400 });
      }
      await prisma.routeTrip.update({
        where: { id: trip.id },
        data: { status: 'IN_PROGRESS', startedByDispatcher: isDispatcher },
      });
    } else {
      if (markReturned === true) {
        if (existing.status !== 'COMPLETED') {
          return NextResponse.json({ error: 'すべての配送先が完了してから帰社を記録してください' }, { status: 400 });
        }
        if (existing.returnedAt !== null) {
          return NextResponse.json({ error: '既に帰社記録済みです' }, { status: 400 });
        }
      }
      if (markReturned === false && existing.returnedAt === null) {
        return NextResponse.json({ error: '帰社の記録がありません' }, { status: 400 });
      }
      const returnedAt = new Date();
      await prisma.$transaction(async tx => {
        await tx.planRoute.update({
          where: { id: params.routeId },
          data: {
            ...(status !== undefined && { status }),
            // ドライバーが「運送開始」を押し忘れた場合の、本部（リアルタイム追跡画面）による代理操作を記録する
            ...(status === 'IN_PROGRESS' && { startedByDispatcher: isDispatcher }),
            ...(markReturned === true && { returnedAt, returnedByDispatcher: isDispatcher }),
            // 本部側の誤操作訂正用：帰社記録の取消（ドライバー画面には元々取消操作がないため、この経路のみ）
            ...(markReturned === false && { returnedAt: null, returnedByDispatcher: false }),
          },
        });
        // 運送開始と同時に、便があれば1便目（tripIndex: 0）も進行中にする（2便目以降はPENDINGのまま）
        if (status === 'IN_PROGRESS') {
          const firstTrip = existing.trips.find(t => t.tripIndex === 0);
          if (firstTrip && firstTrip.status === 'PENDING') {
            await tx.routeTrip.update({
              where: { id: firstTrip.id },
              data: { status: 'IN_PROGRESS', startedByDispatcher: isDispatcher },
            });
          }
        }
        // 便を使うルートで最後の便は、「この便を完了して本社へ」ボタンを経由せず（isLastTripには
        // 表示されない）、全停車地の自動解決（tracking/stops/[id]/route.tsのallStopsResolved）で
        // status: COMPLETEDになるだけでreturnedAtは設定されない。そのため「帰社」ボタンでルート全体の
        // returnedAtは記録されても、最後の便自身のreturnedAtが空のままになり、ガントチャート上
        // 「帰社予定」（未実績）のまま表示され続けるバグがあった。帰社記録・取消の両方で最後の便の
        // returnedAtも同期する
        // ただし対象は実際に完了している便（status: COMPLETED）に限る。停車地0件の空便（未割当に
        // 戻す等で残ったもの）は自動解決の対象外でstatusがPENDINGのまま残るため、ここで無条件に
        // returnedAtだけ書き込むと「PENDINGなのに帰社実績あり」という矛盾データになってしまう
        if (existing.trips.length > 0) {
          const lastTrip = existing.trips[existing.trips.length - 1];
          if (lastTrip.status === 'COMPLETED') {
            if (markReturned === true && lastTrip.returnedAt === null) {
              await tx.routeTrip.update({ where: { id: lastTrip.id }, data: { returnedAt } });
            }
            if (markReturned === false) {
              await tx.routeTrip.update({ where: { id: lastTrip.id }, data: { returnedAt: null } });
            }
          }
        }
      });
    }

    const route = await prisma.planRoute.findUniqueOrThrow({ where: { id: params.routeId } });
    return NextResponse.json(route);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: '対象のルートが見つかりません（削除された可能性があります）' }, { status: 404 });
    }
    console.error(error);
    return NextResponse.json({ error: 'ステータスの更新に失敗しました' }, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { routeId: string } }
) {
  try {
    const route = await prisma.planRoute.findUnique({
      where: { id: params.routeId },
      include: {
        truck: true,
        // ログインなしで開ける画面のため、配送に要らないドライバーの個人情報（電話番号・免許証番号など）は返さない
        driver: { select: { id: true, name: true } },
        stops: {
          orderBy: { stopOrder: 'asc' },
          include: { location: true },
        },
        fuelLogs: {
          orderBy: { timestamp: 'desc' },
        },
        trips: { orderBy: { tripIndex: 'asc' } },
      },
    });
    if (!route) {
      return NextResponse.json({ error: 'ルートが見つかりません' }, { status: 404 });
    }
    const { denied } = await checkDriverAccess(req, route.routeDate);
    if (denied) return denied;
    return NextResponse.json(route);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'ルート情報の取得に失敗しました' }, { status: 500 });
  }
}
