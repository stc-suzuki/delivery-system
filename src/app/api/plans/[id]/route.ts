import { NextRequest, NextResponse } from 'next/server';
import { format } from 'date-fns';
import { prisma } from '@/lib/prisma';
import { canEditRoute, getEditHorizonDays } from '@/lib/planEditPolicy';
import { checkDriverAvailable, checkDriverNotOnDayOff } from '@/lib/planValidation';

// [id] = ルート（トラック1台分）のID。以前はDeliveryPlan（複数トラックの束）のIDだったが、
// プラン廃止に伴いルート単体を指す
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const route = await prisma.planRoute.findUnique({
      where: { id: params.id },
      include: {
        truck: true,
        driver: true,
        stops: { orderBy: { stopOrder: 'asc' }, include: { location: true, packages: true } },
        trips: { orderBy: { tripIndex: 'asc' } },
      },
    });
    if (!route) {
      return NextResponse.json({ error: '配送ルートが見つかりません' }, { status: 404 });
    }
    return NextResponse.json(route);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '配送ルートの取得に失敗しました' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const route = await prisma.planRoute.findUnique({ where: { id: params.id } });
    if (!route) {
      return NextResponse.json({ error: '配送ルートが見つかりません' }, { status: 404 });
    }
    if (!canEditRoute(route, await getEditHorizonDays())) {
      return NextResponse.json({ error: 'このルートは編集できません' }, { status: 403 });
    }

    const body = await req.json();
    const { note, routeDate, driverId } = body as { note?: string; routeDate?: string; driverId?: string };

    // 稼働中・完了済みルートは、既にそのルートに紐づく配送先の対象日（DeliveryStop.stopDate）が
    // 固定されているため、routeDateだけ変えるとルートと停車地の日付がズレた不整合な状態になる。
    // 画面側（稼働中ルート編集画面）の対象日入力は無効化しているが、念のためサーバー側でも拒否する
    if (routeDate !== undefined && route.status !== 'PENDING') {
      return NextResponse.json({ error: '稼働開始後のルートは対象日を変更できません' }, { status: 400 });
    }

    // 対象日の一括変更は、同日でまだ稼働していない（PENDING）ルート全体を巻き込んで更新する
    // （複数トラックの構成をまとめて組む画面が日付単位で操作するため）。稼働中・完了済みルート自身の
    // 日付を変更する場合は、他のルートを巻き込まず単体で更新する
    const isPendingDateBatch = routeDate !== undefined && route.status === 'PENDING';
    const targetIds = isPendingDateBatch
      ? (
          await prisma.planRoute.findMany({
            where: { routeDate: route.routeDate, status: 'PENDING' },
            select: { id: true },
          })
        ).map(r => r.id)
      : [route.id];

    if (note !== undefined || routeDate !== undefined) {
      await prisma.planRoute.updateMany({
        where: { id: { in: targetIds } },
        data: {
          ...(note !== undefined && { note }),
          ...(routeDate !== undefined && { routeDate: new Date(routeDate) }),
        },
      });
    }

    // ドライバー変更は、稼働中・完了済みルートも含めて単体で行える（2026-08-27決定）。
    // 他のトラックの構成には影響しないため、上記の一括更新とは独立させる
    if (driverId !== undefined) {
      const driverOk = await checkDriverAvailable(route.routeDate, driverId, route.id);
      if (!driverOk) {
        const driver = await prisma.driver.findUnique({ where: { id: driverId } });
        return NextResponse.json({ error: `ドライバー ${driver?.name ?? driverId} は同日に既に割り当てられています` }, { status: 400 });
      }
      const dayOffOk = await checkDriverNotOnDayOff(route.routeDate, driverId);
      if (!dayOffOk) {
        const driver = await prisma.driver.findUnique({ where: { id: driverId } });
        return NextResponse.json({ error: `ドライバー ${driver?.name ?? driverId} は当日休日として設定されているため、割り当てられません` }, { status: 400 });
      }
      await prisma.planRoute.update({ where: { id: route.id }, data: { driverId } });
    }

    const updated = await prisma.planRoute.findUnique({ where: { id: params.id } });
    return NextResponse.json(updated);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '配送ルートの更新に失敗しました' }, { status: 500 });
  }
}

// このルート（トラック1台分）を削除する。割り当てられていた停車地は削除せず未割当（プール）へ解放する
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const route = await prisma.planRoute.findUnique({ where: { id: params.id } });
    if (!route) {
      return NextResponse.json({ error: '配送ルートが見つかりません' }, { status: 404 });
    }

    if (route.status !== 'PENDING') {
      const body = await req.json().catch(() => ({}));
      const expected = format(new Date(route.routeDate), 'yyyy-MM-dd');
      if (body.confirmRouteDate !== expected) {
        return NextResponse.json(
          {
            error: '運送が開始されているルートです。確認のため対象日の入力が必要です',
            requiresConfirmation: true,
            routeDate: expected,
          },
          { status: 409 }
        );
      }
    }

    await prisma.$transaction(async tx => {
      // 荷物データ自体は消さずプールへ解放する（配送ルート＝トラック割当の器を消すだけ）
      await tx.deliveryStop.updateMany({
        where: { routeId: route.id },
        data: { routeId: null, tripId: null },
      });
      await tx.trackingLog.deleteMany({ where: { routeId: route.id } });
      await tx.fuelLog.deleteMany({ where: { routeId: route.id } });
      // RouteTrip.routeIdはON DELETE RESTRICTのため、ルート削除前に便を先に消す必要がある
      await tx.routeTrip.deleteMany({ where: { routeId: route.id } });
      await tx.planRoute.delete({ where: { id: route.id } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '配送ルートの削除に失敗しました' }, { status: 500 });
  }
}
