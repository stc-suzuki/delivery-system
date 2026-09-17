import { NextRequest, NextResponse } from 'next/server';
import { format } from 'date-fns';
import { prisma } from '@/lib/prisma';
import { clampCapacityToBed } from '@/lib/loadCapacity';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { plateNo, model, capacityKg, capacityM3, bedWidth, bedDepth, bedHeight, status, defaultDriverId } = body;

    const existing = await prisma.truck.findUnique({ where: { id: params.id } });
    if (!existing) {
      return NextResponse.json({ error: 'トラックが見つかりません' }, { status: 404 });
    }
    if (existing.status === 'RETIRED') {
      return NextResponse.json({ error: '廃車済みのトラックは編集できません' }, { status: 400 });
    }

    const nextBedWidth = bedWidth !== undefined ? (bedWidth === null ? null : Number(bedWidth)) : existing.bedWidth;
    const nextBedDepth = bedDepth !== undefined ? (bedDepth === null ? null : Number(bedDepth)) : existing.bedDepth;
    const nextBedHeight = bedHeight !== undefined ? (bedHeight === null ? null : Number(bedHeight)) : existing.bedHeight;
    const nextBed =
      nextBedWidth != null && nextBedDepth != null && nextBedHeight != null
        ? { width: nextBedWidth, depth: nextBedDepth, height: nextBedHeight }
        : null;
    const nextCapacityM3 = capacityM3 !== undefined ? (capacityM3 === null ? null : Number(capacityM3)) : existing.capacityM3;
    const clampedCapacityM3 = clampCapacityToBed(nextCapacityM3, nextBed);

    const truck = await prisma.truck.update({
      where: { id: params.id },
      data: {
        ...(plateNo !== undefined && { plateNo }),
        ...(model !== undefined && { model }),
        ...(capacityKg !== undefined && { capacityKg: Number(capacityKg) }),
        ...((capacityM3 !== undefined || bedWidth !== undefined || bedDepth !== undefined || bedHeight !== undefined) && {
          capacityM3: clampedCapacityM3,
        }),
        ...(bedWidth !== undefined && { bedWidth: bedWidth === null ? null : Number(bedWidth) }),
        ...(bedDepth !== undefined && { bedDepth: bedDepth === null ? null : Number(bedDepth) }),
        ...(bedHeight !== undefined && { bedHeight: bedHeight === null ? null : Number(bedHeight) }),
        ...(status !== undefined && { status }),
        ...(defaultDriverId !== undefined && { defaultDriverId: defaultDriverId || null }),
      },
    });
    return NextResponse.json(truck);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'トラックの更新に失敗しました' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const truck = await prisma.truck.findUnique({ where: { id: params.id } });
    if (!truck) {
      return NextResponse.json({ error: 'トラックが見つかりません' }, { status: 404 });
    }

    // routeDateは@db.Dateのため、ローカルタイムゾーンのstartOfDayを経由せずUTCの日付境界として今日を組み立てる
    const todayStart = new Date(`${format(new Date(), 'yyyy-MM-dd')}T00:00:00.000Z`);

    // 作成日が過去のまま放置されたPENDING（稼働開始されずテスト等で残った不整合データ）は
    // 「現在・今後の割当」とはみなさず、削除ブロックの対象から除外する
    const activeRouteCount = await prisma.planRoute.count({
      where: {
        truckId: params.id,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        routeDate: { gte: todayStart },
      },
    });
    if (activeRouteCount > 0) {
      return NextResponse.json(
        { error: 'このトラックは進行中または予定の配送ルートに割り当てられているため削除できません' },
        { status: 400 }
      );
    }

    // 完了済みルートの履歴が残っている場合、PlanRoute.truckIdの外部キー制約（ON DELETE RESTRICT）により
    // 物理削除はできない。過去の配送実績を壊さないよう、この場合は廃車扱い（論理削除）にとどめる
    const totalRouteCount = await prisma.planRoute.count({ where: { truckId: params.id } });
    if (totalRouteCount > 0) {
      await prisma.truck.update({ where: { id: params.id }, data: { status: 'RETIRED' } });
      return NextResponse.json({ success: true, mode: 'deactivated' });
    }

    await prisma.truck.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true, mode: 'deleted' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'トラックの削除に失敗しました' }, { status: 500 });
  }
}
