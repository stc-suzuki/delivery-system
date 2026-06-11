import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getIO } from '@/lib/socket';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { routeId, lat, lng } = body;
    if (!routeId || typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json({ error: 'routeId, lat, lng は必須です' }, { status: 400 });
    }

    const route = await prisma.planRoute.findUnique({
      where: { id: routeId },
      include: { stops: true, plan: { include: { routes: true } } },
    });
    if (!route) {
      return NextResponse.json({ error: 'ルートが見つかりません' }, { status: 404 });
    }

    const log = await prisma.trackingLog.create({
      data: { routeId, lat, lng },
    });

    // 初回ログでルートを進行中に更新
    if (route.status === 'PENDING') {
      await prisma.planRoute.update({
        where: { id: routeId },
        data: { status: 'IN_PROGRESS' },
      });

      if (route.plan.status === 'CONFIRMED') {
        await prisma.deliveryPlan.update({
          where: { id: route.planId },
          data: { status: 'IN_PROGRESS' },
        });
      }
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

      const allRoutes = await prisma.planRoute.findMany({ where: { planId: route.planId } });
      const allCompleted = allRoutes.every(r =>
        r.id === routeId ? true : r.status === 'COMPLETED'
      );
      if (allCompleted) {
        await prisma.deliveryPlan.update({
          where: { id: route.planId },
          data: { status: 'COMPLETED' },
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
