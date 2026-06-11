import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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
    const { plateNo, model, capacityKg, status } = body;
    if (!plateNo || !model || !capacityKg) {
      return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
    }
    const truck = await prisma.truck.create({
      data: { plateNo, model, capacityKg: Number(capacityKg), status },
    });
    return NextResponse.json(truck, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'トラックの登録に失敗しました' }, { status: 500 });
  }
}
