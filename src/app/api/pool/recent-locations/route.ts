import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// 荷物受付「新規の受付」の配送先一覧で「最近受け付けた順」に並べるための、配送先ごとの最後の受付。
// lastCreatedAt＝最後に受け付けた日時、lastStopDate＝その配送先の最も新しい配送日
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await prisma.deliveryStop.groupBy({
      by: ['locationId'],
      _max: { createdAt: true, stopDate: true },
    });
    return NextResponse.json(
      rows.map(r => ({
        locationId: r.locationId,
        lastCreatedAt: r._max.createdAt ? r._max.createdAt.toISOString() : null,
        lastStopDate: r._max.stopDate ? r._max.stopDate.toISOString().slice(0, 10) : null,
      }))
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '配送先の受付履歴の取得に失敗しました' }, { status: 500 });
  }
}
