import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// 未割当（プール）の停車地から、指定した荷物だけを新しい停車地（同じ配送先・同じ日）へ
// 切り出す。1配送先の荷物量が1台のトラックに積みきれない場合に、人が明示的に分割して
// それぞれ別のトラックへ手動割当できるようにするための操作。
// 割当済み（routeId設定済み）の停車地は分割対象外（誤操作による重複作成を避けるため、
// 分割は必ずこの明示的な操作からのみ行われる設計とし、プール画面の通常保存では
// 同一配送先・同一日の重複停車地は作られない）。
export async function POST(
  req: NextRequest,
  { params }: { params: { stopId: string } }
) {
  try {
    const stop = await prisma.deliveryStop.findUnique({
      where: { id: params.stopId },
      include: { packages: true },
    });
    if (!stop) {
      return NextResponse.json({ error: '停車地が見つかりません' }, { status: 404 });
    }
    if (stop.routeId !== null) {
      return NextResponse.json(
        { error: '割当済みの停車地は分割できません。未割当の停車地のみ分割できます' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { packageIds } = body as { packageIds: string[] };
    if (!Array.isArray(packageIds) || packageIds.length === 0) {
      return NextResponse.json({ error: '新しい停車地に移す荷物を1件以上選択してください' }, { status: 400 });
    }
    const stopPackageIds = new Set(stop.packages.map(p => p.id));
    if (!packageIds.every(id => stopPackageIds.has(id))) {
      return NextResponse.json({ error: '指定された荷物がこの停車地に見つかりません' }, { status: 400 });
    }
    if (packageIds.length >= stop.packages.length) {
      return NextResponse.json(
        { error: '元の停車地に荷物が1件以上残るように選択してください' },
        { status: 400 }
      );
    }

    const newStopId = await prisma.$transaction(async tx => {
      const created = await tx.deliveryStop.create({
        data: {
          stopDate: stop.stopDate,
          routeId: null,
          locationId: stop.locationId,
          stopOrder: 0,
          requestedArrivalTime: stop.requestedArrivalTime,
          scheduledTime: stop.scheduledTime,
          isTimeFixed: stop.isTimeFixed,
        },
      });
      await tx.package.updateMany({
        where: { id: { in: packageIds } },
        data: { stopId: created.id },
      });
      return created.id;
    });

    const [originalStop, newStop] = await Promise.all([
      prisma.deliveryStop.findUnique({ where: { id: stop.id }, include: { location: true, packages: true } }),
      prisma.deliveryStop.findUnique({ where: { id: newStopId }, include: { location: true, packages: true } }),
    ]);

    return NextResponse.json({ originalStop, newStop });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '停車地の分割に失敗しました' }, { status: 500 });
  }
}
