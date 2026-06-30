import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { orderWithTimeBudget, estimateStopTimes, TOCHIGI_DEPOT } from '@/lib/routeOptimizer';

// 稼働中のルートに配送先を追加し、配達済み・スキップ済みの停車地はそのまま、
// 未配達の停車地＋新規追加分のみを現在地（最新の位置情報、なければ最終配達地点、
// なければ車庫）からの到達順で再最適化する。
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; routeId: string } }
) {
  try {
    const plan = await prisma.deliveryPlan.findUnique({ where: { id: params.id } });
    if (!plan) {
      return NextResponse.json({ error: '配送計画が見つかりません' }, { status: 404 });
    }
    if (plan.status !== 'IN_PROGRESS') {
      return NextResponse.json({ error: 'このAPIは進行中の配送計画にのみ使用できます' }, { status: 403 });
    }

    const route = await prisma.planRoute.findUnique({
      where: { id: params.routeId },
      include: { stops: { include: { location: true }, orderBy: { stopOrder: 'asc' } } },
    });
    if (!route || route.planId !== params.id) {
      return NextResponse.json({ error: 'ルートが見つかりません' }, { status: 404 });
    }
    if (route.status === 'COMPLETED') {
      return NextResponse.json({ error: 'このルートは既に完了しています' }, { status: 400 });
    }

    const body = await req.json();
    const { locationIds, arrivalTimes } = body as {
      locationIds: string[];
      arrivalTimes?: Record<string, string>;
    };
    if (!Array.isArray(locationIds) || locationIds.length === 0) {
      return NextResponse.json({ error: 'locationIds は1件以上指定してください' }, { status: 400 });
    }

    const newLocations = await prisma.location.findMany({ where: { id: { in: locationIds } } });
    if (newLocations.length === 0) {
      return NextResponse.json({ error: '指定された配送先が見つかりません' }, { status: 400 });
    }

    const fixedStops = route.stops.filter(s => s.status !== 'PENDING');
    const pendingStops = route.stops.filter(s => s.status === 'PENDING');
    const maxFixedOrder = fixedStops.length > 0 ? Math.max(...fixedStops.map(s => s.stopOrder)) : -1;

    // 現在地: 最新の位置情報 > 直近の配達済み地点 > 車庫
    const lastLog = await prisma.trackingLog.findFirst({
      where: { routeId: route.id },
      orderBy: { timestamp: 'desc' },
    });
    const lastCompletedStop = [...fixedStops].reverse().find(s => s.status === 'COMPLETED');
    const currentPos = lastLog
      ? { lat: lastLog.lat, lng: lastLog.lng }
      : lastCompletedStop
      ? { lat: lastCompletedStop.location.lat, lng: lastCompletedStop.location.lng }
      : TOCHIGI_DEPOT;

    const settings = await prisma.systemSetting.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });
    const planDateBase = new Date(plan.planDate);
    const [lunchStartHour, lunchStartMinute] = settings.lunchBreakStart.split(':').map(Number);
    const lunchStart = new Date(planDateBase);
    lunchStart.setHours(lunchStartHour, lunchStartMinute, 0, 0);
    const [lunchEndHour, lunchEndMinute] = settings.lunchBreakEnd.split(':').map(Number);
    const lunchEnd = new Date(planDateBase);
    lunchEnd.setHours(lunchEndHour, lunchEndMinute, 0, 0);
    const lunchBreak = lunchEnd.getTime() > lunchStart.getTime() ? { start: lunchStart, end: lunchEnd } : undefined;

    const now = new Date();

    type Combined = { id: string; locationId: string; lat: number; lng: number; arrivalTime: string | null; isExisting: boolean };
    const combined: Combined[] = [
      ...pendingStops.map(s => ({
        id: s.id,
        locationId: s.locationId,
        lat: s.location.lat,
        lng: s.location.lng,
        arrivalTime: s.isTimeFixed && s.scheduledTime ? s.scheduledTime.toISOString() : null,
        isExisting: true,
      })),
      ...newLocations.map(l => ({
        id: l.id,
        locationId: l.id,
        lat: l.lat,
        lng: l.lng,
        arrivalTime: arrivalTimes?.[l.id] ?? null,
        isExisting: false,
      })),
    ];

    const ordered = orderWithTimeBudget(currentPos, now, combined, lunchBreak);
    const timed = estimateStopTimes(currentPos, now, ordered, lunchBreak, settings.defaultStopDurationMinutes);

    const updatedPlan = await prisma.$transaction(async tx => {
      for (let i = 0; i < timed.length; i++) {
        const item = timed[i];
        const stopOrder = maxFixedOrder + 1 + i;
        if (item.isExisting) {
          await tx.deliveryStop.update({
            where: { id: item.id },
            data: { stopOrder, scheduledTime: item.estimatedTime },
          });
        } else {
          await tx.deliveryStop.create({
            data: {
              routeId: route.id,
              locationId: item.locationId,
              stopOrder,
              scheduledTime: item.estimatedTime,
              isTimeFixed: !!item.arrivalTime,
            },
          });
        }
      }
      return tx.deliveryPlan.findUnique({
        where: { id: params.id },
        include: {
          routes: {
            orderBy: { sortOrder: 'asc' },
            include: {
              truck: true,
              driver: true,
              stops: { orderBy: { stopOrder: 'asc' }, include: { location: true } },
            },
          },
        },
      });
    });

    return NextResponse.json(updatedPlan);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '配送先の追加・再最適化に失敗しました' }, { status: 500 });
  }
}
