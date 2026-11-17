import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// 荷物受付「登録内容の確認・修正」の「配送先で探す」（2026-11-17導入）：今日（日本時間）以降の受付をすべて返す。
// 日付を覚えていない変更・取り消しの電話のとき、配送先から受付を探すため。画面側で配送先ごとにまとめる。
// 過去の受付は修正できないので返さない
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
    const stops = await prisma.deliveryStop.findMany({
      where: { stopDate: { gte: new Date(`${today}T00:00:00.000Z`) } },
      include: {
        location: { select: { id: true, name: true, phone: true, address: true } },
        packages: true,
        route: { select: { id: true, truck: { select: { plateNo: true } }, driver: { select: { name: true } } } },
      },
      orderBy: [{ stopDate: 'asc' }, { id: 'asc' }],
    });
    return NextResponse.json(
      stops.map(s => ({ ...s, stopDate: s.stopDate.toISOString().slice(0, 10) }))
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '受付の取得に失敗しました' }, { status: 500 });
  }
}
