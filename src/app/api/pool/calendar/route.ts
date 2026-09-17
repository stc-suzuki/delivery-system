import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// 指定期間（from〜to、共にYYYY-MM-DDで両端を含む）の各日について、登録済みの配送先数
// （DeliveryStopのlocationId重複除き件数）を返す。
// プール登録画面（/pool）のカレンダー表示で、登録済/未登録の色分けと配送先数バッジに使う。
// カレンダーは月の前後にはみ出す前月末・翌月初の日にちも同じグリッドに表示するため、
// 呼び出し側（画面）はその表示範囲全体をfrom/toとして渡す（月単位に限定しない）
// 割当済み・未割当・分割済みを問わず、その日に登録されている配送先を数える
export async function GET(req: NextRequest) {
  try {
    const fromStr = req.nextUrl.searchParams.get('from');
    const toStr = req.nextUrl.searchParams.get('to');
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    if (!fromStr || !toStr || !dateOnly.test(fromStr) || !dateOnly.test(toStr)) {
      return NextResponse.json({ error: 'from/to はYYYY-MM-DD形式で指定してください' }, { status: 400 });
    }
    // stopDateはPostgresの@db.Date列（タイムゾーンを持たない）。ここでローカル時刻（JST）でDateを組み立てると、
    // 比較時にUTCで日付部分へ丸められて境界の日にちが範囲から漏れる/隣の日が紛れ込む不具合になるため、
    // 境界は必ずUTC固定（T00:00:00.000Z）で組み立てる。toは指定日を含むため、比較には翌日0時（exclusive）を使う
    const from = new Date(`${fromStr}T00:00:00.000Z`);
    const toExclusive = new Date(`${toStr}T00:00:00.000Z`);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

    const stops = await prisma.deliveryStop.findMany({
      where: { stopDate: { gte: from, lt: toExclusive } },
      select: { stopDate: true, locationId: true },
    });

    const locationIdsByDate = new Map<string, Set<string>>();
    for (const s of stops) {
      const key = s.stopDate.toISOString().slice(0, 10);
      if (!locationIdsByDate.has(key)) locationIdsByDate.set(key, new Set());
      locationIdsByDate.get(key)!.add(s.locationId);
    }

    const counts: Record<string, number> = {};
    locationIdsByDate.forEach((ids, key) => {
      counts[key] = ids.size;
    });

    return NextResponse.json({ counts });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'カレンダー情報の取得に失敗しました' }, { status: 500 });
  }
}
