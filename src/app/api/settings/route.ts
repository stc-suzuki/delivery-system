import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { geocodeAddress } from '@/lib/geocode';
import { reorderRoute } from '@/lib/routeReorder';

export async function GET() {
  try {
    const settings = await prisma.systemSetting.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });
    return NextResponse.json(settings);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '設定の取得に失敗しました' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      defaultDepartureTime,
      lunchBreakStart,
      lunchBreakEnd,
      deliveryEndTime,
      defaultStopDurationMinutes,
      truckScheduleHorizonDays,
      excludeWeekendsAndHolidays,
      loadUtilizationPercent,
      assumedTripsPerDay,
      reloadDurationMinutes,
      assignmentStrategy,
      averageSpeedKmh,
      roadDetourFactor,
      perLegTravelMinutes,
      depotName,
      depotAddress,
    } = body;

    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(defaultDepartureTime) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(lunchBreakStart) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(lunchBreakEnd) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(deliveryEndTime)
    ) {
      return NextResponse.json({ error: '時刻はHH:mm形式で入力してください' }, { status: 400 });
    }
    if (!Number.isInteger(defaultStopDurationMinutes) || defaultStopDurationMinutes <= 0) {
      return NextResponse.json({ error: '積み下ろし時間は正の整数で入力してください' }, { status: 400 });
    }
    if (!Number.isInteger(truckScheduleHorizonDays) || truckScheduleHorizonDays < 1 || truckScheduleHorizonDays > 30) {
      return NextResponse.json({ error: 'トラック稼働登録の可能日数は1〜30の整数で入力してください' }, { status: 400 });
    }
    if (typeof excludeWeekendsAndHolidays !== 'boolean') {
      return NextResponse.json({ error: '土日祝日配送除外日の指定が不正です' }, { status: 400 });
    }
    if (!Number.isInteger(loadUtilizationPercent) || loadUtilizationPercent < 10 || loadUtilizationPercent > 100) {
      return NextResponse.json({ error: '積載利用率は10〜100の整数で入力してください' }, { status: 400 });
    }
    if (!Number.isInteger(assumedTripsPerDay) || assumedTripsPerDay < 1) {
      return NextResponse.json({ error: '1日あたりの想定往復回数は1以上の整数で入力してください' }, { status: 400 });
    }
    if (!Number.isInteger(reloadDurationMinutes) || reloadDurationMinutes <= 0) {
      return NextResponse.json({ error: '本社での積み込み時間は正の整数で入力してください' }, { status: 400 });
    }
    if (assignmentStrategy !== 'SWEEP' && assignmentStrategy !== 'SWEEP_BALANCED') {
      return NextResponse.json({ error: 'AI提案の割当方式の指定が不正です' }, { status: 400 });
    }
    if (!Number.isInteger(averageSpeedKmh) || averageSpeedKmh < 5 || averageSpeedKmh > 100) {
      return NextResponse.json({ error: '移動時間の平均時速は5〜100の整数で入力してください' }, { status: 400 });
    }
    if (typeof roadDetourFactor !== 'number' || !(roadDetourFactor >= 1 && roadDetourFactor <= 3)) {
      return NextResponse.json({ error: '回り道係数は1.0〜3.0の数値で入力してください' }, { status: 400 });
    }
    if (!Number.isInteger(perLegTravelMinutes) || perLegTravelMinutes < 0 || perLegTravelMinutes > 60) {
      return NextResponse.json({ error: '1区間ごとの固定時間は0〜60の整数で入力してください' }, { status: 400 });
    }
    if (typeof depotName !== 'string' || depotName.trim() === '') {
      return NextResponse.json({ error: '本部名称を入力してください' }, { status: 400 });
    }
    if (typeof depotAddress !== 'string') {
      return NextResponse.json({ error: '本部住所の指定が不正です' }, { status: 400 });
    }

    // 住所が変わった場合のみ再ジオコーディングする（配送先マスタと同じ方針）。
    // 未入力（空文字）の間は既存の座標（初期値または前回保存分）をそのまま維持する
    const existing = await prisma.systemSetting.findUnique({ where: { id: 'default' } });
    const addressChanged = depotAddress !== '' && depotAddress !== existing?.depotAddress;
    const geo = addressChanged ? await geocodeAddress(depotAddress) : undefined;

    const settings = await prisma.systemSetting.upsert({
      where: { id: 'default' },
      update: {
        defaultDepartureTime,
        lunchBreakStart,
        lunchBreakEnd,
        deliveryEndTime,
        defaultStopDurationMinutes,
        truckScheduleHorizonDays,
        excludeWeekendsAndHolidays,
        loadUtilizationPercent,
        assumedTripsPerDay,
        reloadDurationMinutes,
        assignmentStrategy,
        averageSpeedKmh,
        roadDetourFactor,
        perLegTravelMinutes,
        depotName,
        depotAddress,
        ...(geo && { depotLat: geo.lat, depotLng: geo.lng }),
      },
      create: {
        id: 'default',
        defaultDepartureTime,
        lunchBreakStart,
        lunchBreakEnd,
        deliveryEndTime,
        defaultStopDurationMinutes,
        truckScheduleHorizonDays,
        excludeWeekendsAndHolidays,
        loadUtilizationPercent,
        assumedTripsPerDay,
        reloadDurationMinutes,
        assignmentStrategy,
        averageSpeedKmh,
        roadDetourFactor,
        perLegTravelMinutes,
        depotName,
        depotAddress,
        ...(geo && { depotLat: geo.lat, depotLng: geo.lng }),
      },
    });
    // 移動時間の見積もりを変えた場合、まだ出発していない今日以降のルートの到着予定（割当時に保存した値）を
    // 新しい見積もりで計算し直す（しないとガントチャート・ドライバー画面に古い時刻が残る）
    const travelChanged =
      existing != null &&
      (existing.averageSpeedKmh !== averageSpeedKmh ||
        existing.roadDetourFactor !== roadDetourFactor ||
        existing.perLegTravelMinutes !== perLegTravelMinutes);
    if (travelChanged) {
      await recomputePendingRoutesFromToday();
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : '設定の更新に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// 今日（日本時間）以降の、まだ出発していない（PENDING）・配送先が割当済みのルートの到着予定を計算し直す
async function recomputePendingRoutesFromToday() {
  const todayJst = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const routes = await prisma.planRoute.findMany({
    where: { status: 'PENDING', routeDate: { gte: new Date(`${todayJst}T00:00:00.000Z`) }, stops: { some: {} } },
    select: { id: true },
  });
  for (const r of routes) {
    await prisma.$transaction(tx => reorderRoute(tx, r.id));
  }
}
