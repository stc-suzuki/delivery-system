import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canEditRoute, getEditHorizonDays } from '@/lib/planEditPolicy';
import { MAX_STOPS_PER_ROUTE } from '@/lib/planValidation';
import { reorderRoute } from '@/lib/routeReorder';

// 手動でのトラック割当・解除。プールの停車地を指定したルートへ割り当てる、
// または割当済みの停車地を未割当（プール）へ戻す。自動割当（suggest）は参考データに過ぎず、
// 実際の割当確定はすべてこのエンドポイント経由で行う。
// 以前は/plans/[id]/stops/[stopId]（[id]=配送計画ID）だったが、プラン廃止に伴い
// stopIdだけで一意に操作できるためplan配下から独立させた
export async function PATCH(
  req: NextRequest,
  { params }: { params: { stopId: string } }
) {
  try {
    const stop = await prisma.deliveryStop.findUnique({
      where: { id: params.stopId },
      include: { route: true },
    });
    if (!stop) {
      return NextResponse.json({ error: '停車地が見つかりません' }, { status: 404 });
    }
    if (stop.route && stop.route.status !== 'PENDING') {
      return NextResponse.json({ error: '稼働中のため手動割当の変更はできません' }, { status: 400 });
    }

    const body = await req.json();
    const { routeId, tripId } = body as { routeId: string | null; tripId?: string | null };

    const previousRouteId = stop.routeId;
    const warnings: string[] = [];

    if (routeId === null) {
      await prisma.deliveryStop.update({
        where: { id: stop.id },
        // 未割当（プール）に戻す際は、ルート計算による見込み時刻のズレを、お客様への到着希望時刻に戻しておく
        data: { routeId: null, tripId: null, hasTimeConflict: false, scheduledTime: stop.requestedArrivalTime },
      });
    } else {
      const targetRoute = await prisma.planRoute.findUnique({
        where: { id: routeId },
        include: { truck: true, trips: true },
      });
      if (!targetRoute) {
        return NextResponse.json({ error: '指定されたルートが見つかりません' }, { status: 400 });
      }
      if (targetRoute.status !== 'PENDING') {
        return NextResponse.json({ error: 'このルートは稼働中のため手動割当はできません' }, { status: 400 });
      }
      if (!canEditRoute(targetRoute, await getEditHorizonDays())) {
        return NextResponse.json({ error: `トラック ${targetRoute.truck.plateNo} のルートは編集できません` }, { status: 403 });
      }
      if (stop.stopDate.getTime() !== targetRoute.routeDate.getTime()) {
        return NextResponse.json({ error: 'この停車地は指定されたルートの対象日と一致しません' }, { status: 400 });
      }

      // ルートは常に便（RouteTrip）を1件以上持つ不変条件のため、割当には必ずどの便かの指定が必要
      const trip = tripId ? targetRoute.trips.find(t => t.id === tripId) : undefined;
      if (!trip) {
        return NextResponse.json({ error: '割り当てる便を指定してください' }, { status: 400 });
      }
      const resolvedTripId: string = trip.id;

      if (targetRoute.id !== previousRouteId) {
        const currentCount = await prisma.deliveryStop.count({ where: { routeId: targetRoute.id } });
        if (currentCount + 1 > MAX_STOPS_PER_ROUTE) {
          return NextResponse.json(
            { error: `1ルートあたりの停車地は最大${MAX_STOPS_PER_ROUTE}件までです` },
            { status: 400 }
          );
        }
      }

      await prisma.deliveryStop.update({
        where: { id: stop.id },
        data: { routeId: targetRoute.id, tripId: resolvedTripId },
      });
    }

    await prisma.$transaction(async tx => {
      if (routeId !== null) {
        const { warnings: w } = await reorderRoute(tx, routeId);
        warnings.push(...w);
      }
      if (previousRouteId && previousRouteId !== routeId) {
        const { warnings: w } = await reorderRoute(tx, previousRouteId);
        warnings.push(...w);
      }
    });

    const updatedStop = await prisma.deliveryStop.findUnique({
      where: { id: stop.id },
      include: { location: true, packages: true },
    });

    return NextResponse.json({ stop: updatedStop, warnings });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '割当の更新に失敗しました' }, { status: 500 });
  }
}
