import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

// POST: 給油記録の追加
export async function POST(req: NextRequest) {
  try {
    // tripId: 便を使うルートで、給油時点でドライバーが対応中の便のID（任意）。
    // 便を使わないルート・未指定時はnullのまま記録する
    const { routeId, tripId } = await req.json();
    if (!routeId) {
      return NextResponse.json({ error: 'routeId は必須です' }, { status: 400 });
    }
    const log = await prisma.fuelLog.create({ data: { routeId, tripId: tripId ?? null } });
    return NextResponse.json(log, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return NextResponse.json({ error: '対象のルートが見つかりません（配送計画が削除された可能性があります）' }, { status: 404 });
    }
    console.error(error);
    return NextResponse.json({ error: '給油記録の追加に失敗しました' }, { status: 500 });
  }
}
