import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

// POST: 給油記録の追加
export async function POST(req: NextRequest) {
  try {
    const { routeId } = await req.json();
    if (!routeId) {
      return NextResponse.json({ error: 'routeId は必須です' }, { status: 400 });
    }
    const log = await prisma.fuelLog.create({ data: { routeId } });
    return NextResponse.json(log, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return NextResponse.json({ error: '対象のルートが見つかりません（配送計画が削除された可能性があります）' }, { status: 404 });
    }
    console.error(error);
    return NextResponse.json({ error: '給油記録の追加に失敗しました' }, { status: 500 });
  }
}
