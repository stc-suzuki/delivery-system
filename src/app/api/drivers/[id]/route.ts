import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { format } from 'date-fns';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const driver = await prisma.driver.findUnique({ where: { id: params.id } });
    if (!driver) {
      return NextResponse.json({ error: 'ドライバーが見つかりません' }, { status: 404 });
    }

    // routeDateは@db.Dateのため、ローカルタイムゾーンのstartOfDayを経由せずUTCの日付境界として今日を組み立てる
    const todayStart = new Date(`${format(new Date(), 'yyyy-MM-dd')}T00:00:00.000Z`);

    // 作成日が過去のまま放置されたPENDING（稼働開始されずテスト等で残った不整合データ）は
    // 「現在・今後の割当」とはみなさず、削除ブロックの対象から除外する
    const activeRouteCount = await prisma.planRoute.count({
      where: {
        driverId: params.id,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        routeDate: { gte: todayStart },
      },
    });
    if (activeRouteCount > 0) {
      return NextResponse.json(
        { error: 'このドライバーは進行中または予定の配送ルートに割り当てられているため削除できません' },
        { status: 400 }
      );
    }

    // 完了済みルートの履歴が残っている場合、PlanRoute.driverIdの外部キー制約（ON DELETE RESTRICT）により
    // 物理削除はできない。過去の配送実績を壊さないよう、この場合は非稼働化（論理削除）にとどめる
    const totalRouteCount = await prisma.planRoute.count({ where: { driverId: params.id } });
    if (totalRouteCount > 0) {
      await prisma.driver.update({ where: { id: params.id }, data: { status: 'INACTIVE' } });
      return NextResponse.json({ success: true, mode: 'deactivated' });
    }

    await prisma.$transaction([
      prisma.driverDayOff.deleteMany({ where: { driverId: params.id } }),
      prisma.driver.delete({ where: { id: params.id } }),
    ]);
    return NextResponse.json({ success: true, mode: 'deleted' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'ドライバーの削除に失敗しました' }, { status: 500 });
  }
}
