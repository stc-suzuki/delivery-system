import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canEditRoute, getEditHorizonDays } from '@/lib/planEditPolicy';

// [id] = ルート（トラック1台分）のID、[tripId] = 便のID。
// 歯抜け防止のため、そのルートで最後（tripIndexが最大）の便のみ削除可能。
// 停車地が1件でも割り当たっていれば削除しない（先に停車地を他の便へ移すか未割当に戻す必要がある）。
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; tripId: string } }
) {
  try {
    const route = await prisma.planRoute.findUnique({
      where: { id: params.id },
      include: { trips: { orderBy: { tripIndex: 'desc' } } },
    });
    if (!route) {
      return NextResponse.json({ error: '配送ルートが見つかりません' }, { status: 404 });
    }
    if (!canEditRoute(route, await getEditHorizonDays())) {
      return NextResponse.json({ error: 'このルートは編集できません' }, { status: 403 });
    }
    if (route.status !== 'PENDING') {
      return NextResponse.json({ error: '稼働中のため便を削除できません' }, { status: 400 });
    }

    const trip = await prisma.routeTrip.findUnique({ where: { id: params.tripId } });
    if (!trip || trip.routeId !== route.id) {
      return NextResponse.json({ error: '指定された便が見つかりません' }, { status: 404 });
    }
    const lastTrip = route.trips[0];
    if (!lastTrip || lastTrip.id !== trip.id) {
      return NextResponse.json({ error: '最後の便のみ削除できます' }, { status: 400 });
    }
    // ルートは常に便を1件以上持つ不変条件のため、最後の1便は削除できない
    if (route.trips.length <= 1) {
      return NextResponse.json({ error: '最後の1便は削除できません' }, { status: 400 });
    }

    const stopCount = await prisma.deliveryStop.count({ where: { tripId: trip.id } });
    if (stopCount > 0) {
      return NextResponse.json(
        { error: 'この便には配送先が割り当てられているため削除できません' },
        { status: 400 }
      );
    }

    await prisma.routeTrip.delete({ where: { id: trip.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '便の削除に失敗しました' }, { status: 500 });
  }
}
