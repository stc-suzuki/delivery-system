import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { routeId: string } }
) {
  try {
    const { status } = await req.json();
    const existing = await prisma.planRoute.findUnique({
      where: { id: params.routeId },
      include: { plan: true },
    });
    if (!existing) {
      return NextResponse.json({ error: '対象のルートが見つかりません（配送計画が削除された可能性があります）' }, { status: 404 });
    }
    if (existing.status === 'PENDING' && existing.plan.status === 'DRAFT') {
      return NextResponse.json({ error: 'この配送計画はまだ確定されていません' }, { status: 403 });
    }
    const route = await prisma.planRoute.update({
      where: { id: params.routeId },
      data: { status },
    });
    return NextResponse.json(route);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: '対象のルートが見つかりません（配送計画が削除された可能性があります）' }, { status: 404 });
    }
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
        fuelLogs: {
          orderBy: { timestamp: 'desc' },
        },
      },
    });
    if (!route) {
      return NextResponse.json({ error: 'ルートが見つかりません' }, { status: 404 });
    }
    if (route.status === 'PENDING' && route.plan.status === 'DRAFT') {
      return NextResponse.json({ error: 'この配送計画はまだ確定されていません' }, { status: 403 });
    }
    return NextResponse.json(route);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'ルート情報の取得に失敗しました' }, { status: 500 });
  }
}
