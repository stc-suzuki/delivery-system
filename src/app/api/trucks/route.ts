import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveTruckBed } from '@/lib/loadCapacity';

export async function GET() {
  try {
    const trucks = await prisma.truck.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json(trucks);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'トラックの取得に失敗しました' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // 容積上限（capacityM3）はリクエストで受け取らず、荷台寸法から計算する
    const { plateNo, model, capacityKg, bedWidth, bedDepth, bedHeight, status, defaultDriverId } = body;
    if (!plateNo || !model || !capacityKg) {
      return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
    }
    const resolved = resolveTruckBed({ bedWidth, bedDepth, bedHeight });
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    const truck = await prisma.truck.create({
      data: {
        plateNo,
        model,
        capacityKg: Number(capacityKg),
        capacityM3: resolved.capacityM3,
        bedWidth: resolved.bed.width,
        bedDepth: resolved.bed.depth,
        bedHeight: resolved.bed.height,
        status,
        defaultDriverId: defaultDriverId || null,
      },
    });
    return NextResponse.json(truck, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'トラックの登録に失敗しました' }, { status: 500 });
  }
}
