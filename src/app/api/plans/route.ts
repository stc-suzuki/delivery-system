import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get('date');
    const plans = await prisma.deliveryPlan.findMany({
      where: date ? { planDate: new Date(date) } : undefined,
      include: {
        routes: {
          include: { truck: true, driver: true, stops: { include: { location: true }, orderBy: { stopOrder: 'asc' } } },
        },
      },
      orderBy: { planDate: 'desc' },
    });
    return NextResponse.json(plans);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '配送計画の取得に失敗しました' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const body = await req.json();
    const { planDate, note } = body;
    if (!planDate) {
      return NextResponse.json({ error: 'planDate は必須です' }, { status: 400 });
    }
    const plan = await prisma.deliveryPlan.create({
      data: {
        planDate: new Date(planDate),
        note: note ?? null,
        createdBy: session?.user?.email ?? 'unknown',
      },
    });
    return NextResponse.json(plan, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '配送計画の作成に失敗しました' }, { status: 500 });
  }
}
