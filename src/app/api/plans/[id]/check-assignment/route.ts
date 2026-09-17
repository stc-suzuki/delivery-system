import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkTruckAvailable, checkDriverAvailable, checkDriverNotOnDayOff } from '@/lib/planValidation';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const route = await prisma.planRoute.findUnique({ where: { id: params.id } });
    if (!route) {
      return NextResponse.json({ error: '配送ルートが見つかりません' }, { status: 404 });
    }

    const { truckId, driverId } = await req.json();
    if (!truckId || !driverId) {
      return NextResponse.json({ error: 'truckId と driverId を指定してください' }, { status: 400 });
    }

    const truckOk = await checkTruckAvailable(route.routeDate, truckId, route.id);
    if (!truckOk) {
      const truck = await prisma.truck.findUnique({ where: { id: truckId } });
      return NextResponse.json({ error: `トラック ${truck?.plateNo ?? truckId} は同日に既に割り当てられています` }, { status: 400 });
    }

    const driverOk = await checkDriverAvailable(route.routeDate, driverId, route.id);
    if (!driverOk) {
      const driver = await prisma.driver.findUnique({ where: { id: driverId } });
      return NextResponse.json({ error: `ドライバー ${driver?.name ?? driverId} は同日に既に割り当てられています` }, { status: 400 });
    }

    const dayOffOk = await checkDriverNotOnDayOff(route.routeDate, driverId);
    if (!dayOffOk) {
      const driver = await prisma.driver.findUnique({ where: { id: driverId } });
      return NextResponse.json({ error: `ドライバー ${driver?.name ?? driverId} は当日休日として設定されているため、割り当てられません` }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '割り当ての確認に失敗しました' }, { status: 500 });
  }
}
