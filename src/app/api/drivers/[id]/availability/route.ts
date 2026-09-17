import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const dates = await prisma.driverDayOff.findMany({
      where: { driverId: params.id },
      orderBy: { date: 'asc' },
    });
    return NextResponse.json(dates);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '休日設定の取得に失敗しました' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const dates: string[] = body.dates;
    if (!Array.isArray(dates)) {
      return NextResponse.json({ error: 'dates は配列で指定してください' }, { status: 400 });
    }

    const driver = await prisma.driver.findUnique({ where: { id: params.id } });
    if (!driver) {
      return NextResponse.json({ error: 'ドライバーが見つかりません' }, { status: 404 });
    }
    if (driver.status !== 'ACTIVE') {
      return NextResponse.json({ error: '削除済みのドライバーの休日設定は変更できません' }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.driverDayOff.deleteMany({ where: { driverId: params.id } }),
      prisma.driverDayOff.createMany({
        data: dates.map(d => ({ driverId: params.id, date: new Date(d) })),
      }),
    ]);

    const result = await prisma.driverDayOff.findMany({
      where: { driverId: params.id },
      orderBy: { date: 'asc' },
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '休日設定の保存に失敗しました' }, { status: 500 });
  }
}
