import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { routeId: string } }
) {
  try {
    const { status } = await req.json();
    const route = await prisma.planRoute.update({
      where: { id: params.routeId },
      data: { status },
    });
    return NextResponse.json(route);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'ステータスの更新に失敗しました' }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { routeId: string } }
) {
  try {
    const route = await prisma.planRoute.findUnique({
      where: { id: params.routeId },
      include: {
        plan: true,
        truck: true,
        driver: true,
        stops: {
          orderBy: { stopOrder: 'asc' },
          include: { location: true },
        },
      },
    });
    if (!route) {
      return NextResponse.json({ error: 'ルートが見つかりません' }, { status: 404 });
    }
    return NextResponse.json(route);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'ルート情報の取得に失敗しました' }, { status: 500 });
  }
}
