import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { format, startOfDay } from 'date-fns';

// 本日以降でトラックが1台でも登録されている日付の一覧を返す。
// 配送先プール（/pool）が「トラックが登録されている日までしか登録できない」制限を
// かけるために使う（登録可能な上限日の算出と、個別の日の歯抜けチェックの両方に使う）
export async function GET() {
  try {
    const routes = await prisma.planRoute.findMany({
      where: { routeDate: { gte: startOfDay(new Date()) } },
      select: { routeDate: true },
      distinct: ['routeDate'],
      orderBy: { routeDate: 'asc' },
    });
    const dates = routes.map(r => format(r.routeDate, 'yyyy-MM-dd'));
    return NextResponse.json({ dates });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '登録済み日付の取得に失敗しました' }, { status: 500 });
  }
}
