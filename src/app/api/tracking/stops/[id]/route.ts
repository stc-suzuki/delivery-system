import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getIO } from '@/lib/socket';

// PATCH: 停車地のステータス更新（COMPLETED / SKIPPED）
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { status } = body;
    if (!['COMPLETED', 'SKIPPED', 'PENDING'].includes(status)) {
      return NextResponse.json({ error: 'status の値が不正です' }, { status: 400 });
    }

    const stop = await prisma.deliveryStop.update({
      where: { id: params.id },
      data: {
        status,
        arrivedAt: status === 'COMPLETED' ? new Date() : null,
      },
      include: { route: { include: { stops: true, plan: { include: { routes: true } } } } },
    });

    const route = stop.route;

    // 運送開始ボタンの押し忘れ対策: 未開始のまま最初の完了操作が行われたらルートを進行中にする
    if (status === 'COMPLETED' && route.status === 'PENDING') {
      await prisma.planRoute.update({
        where: { id: route.id },
        data: { status: 'IN_PROGRESS' },
      });
    }

    const allStopsResolved =
      route.stops.length > 0 &&
      route.stops.every(s => s.status === 'COMPLETED' || s.status === 'SKIPPED');

    if (allStopsResolved && route.status !== 'COMPLETED') {
      await prisma.planRoute.update({
        where: { id: route.id },
        data: { status: 'COMPLETED' },
      });

      const allRoutes = await prisma.planRoute.findMany({ where: { planId: route.planId } });
      const allCompleted = allRoutes.every(r =>
        r.id === route.id ? true : r.status === 'COMPLETED'
      );
      if (allCompleted) {
        await prisma.deliveryPlan.update({
          where: { id: route.planId },
          data: { status: 'COMPLETED' },
        });
      }
    }

    const io = getIO();
    io?.emit('tracking:stop-update', { stopId: stop.id, status: stop.status, routeId: route.id });

    return NextResponse.json(stop);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: '対象の停車地が見つかりません（配送計画が削除された可能性があります）' }, { status: 404 });
    }
    console.error(error);
    return NextResponse.json({ error: '停車地の更新に失敗しました' }, { status: 500 });
  }
}
