import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// 配送ルート（トラック1台単位）の一覧を返す。以前はDeliveryPlanの下にネストしていたが、
// プランを廃止したためフラットな配列で返す。ルートの新規作成はここでは行わない
// （トラック・ドライバーが必須項目のため、選択前の「空の入れ物」は作れない設計。/plans/newで
// トラックを選び終えた時点で初めて/api/plans/batchが実際のルートを作成する）
export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get('date');
    const routes = await prisma.planRoute.findMany({
      where: date ? { routeDate: new Date(date) } : undefined,
      include: {
        truck: true,
        driver: true,
        stops: { include: { location: true, packages: true }, orderBy: { stopOrder: 'asc' } },
        trips: { orderBy: { tripIndex: 'asc' } },
      },
      orderBy: [{ routeDate: 'desc' }, { sortOrder: 'asc' }],
    });
    return NextResponse.json(routes);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '配送ルートの取得に失敗しました' }, { status: 500 });
  }
}
