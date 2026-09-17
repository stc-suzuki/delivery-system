import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canEditRoute, getEditHorizonDays } from '@/lib/planEditPolicy';

// [id] = ルート（トラック1台分）のID。このルートに新しい便（RouteTrip）を1件作成する。
// 複数便対応フェーズ2：出発前の計画段階で「今日はこのトラック、N便に分ける」と決めるための操作。
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const route = await prisma.planRoute.findUnique({
      where: { id: params.id },
      include: { trips: { orderBy: { tripIndex: 'desc' }, take: 1 } },
    });
    if (!route) {
      return NextResponse.json({ error: '配送ルートが見つかりません' }, { status: 404 });
    }
    if (!canEditRoute(route, await getEditHorizonDays())) {
      return NextResponse.json({ error: 'このルートは編集できません' }, { status: 403 });
    }
    if (route.status !== 'PENDING') {
      return NextResponse.json({ error: '稼働中のため便を追加できません' }, { status: 400 });
    }

    const nextTripIndex = route.trips.length > 0 ? route.trips[0].tripIndex + 1 : 0;
    const trip = await prisma.routeTrip.create({
      data: { routeId: route.id, tripIndex: nextTripIndex },
    });

    return NextResponse.json(trip, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '便の追加に失敗しました' }, { status: 500 });
  }
}
