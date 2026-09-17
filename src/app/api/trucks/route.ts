import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clampCapacityToBed } from '@/lib/loadCapacity';

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
    const { plateNo, model, capacityKg, capacityM3, bedWidth, bedDepth, bedHeight, status, defaultDriverId } = body;
    if (!plateNo || !model || !capacityKg) {
      return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
    }
    const bed =
      bedWidth !== undefined && bedDepth !== undefined && bedHeight !== undefined
        ? { width: Number(bedWidth), depth: Number(bedDepth), height: Number(bedHeight) }
        : null;
    const truck = await prisma.truck.create({
      data: {
        plateNo,
        model,
        capacityKg: Number(capacityKg),
        capacityM3: clampCapacityToBed(capacityM3 !== undefined ? Number(capacityM3) : undefined, bed),
        bedWidth: bedWidth !== undefined ? Number(bedWidth) : undefined,
        bedDepth: bedDepth !== undefined ? Number(bedDepth) : undefined,
        bedHeight: bedHeight !== undefined ? Number(bedHeight) : undefined,
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
