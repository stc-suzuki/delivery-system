import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// 指定期間（from〜to、共にYYYY-MM-DDで両端を含む）の各日について、配送件数（配送先数）と
// 割当状況（未割当の停車地が1件でもあるか）を返す。配送計画＜新規作成＞画面（/plans/new）と
// 配送計画一覧画面（/plans）の日付選択ポップオーバーカレンダーで使う。カレンダーは月の前後に
// はみ出す前月末・翌月初の日にちも同じグリッドに表示するため、呼び出し側（画面）はその表示範囲
// 全体をfrom/toとして渡す（月単位に限定しない）
// 件数はプール登録画面のカレンダー（/api/pool/calendar）と同じく、locationIdの重複を除いた件数
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
      select: { stopDate: true, locationId: true, routeId: true },
    });

    const locationIdsByDate = new Map<string, Set<string>>();
    const hasUnassignedByDate = new Map<string, boolean>();
    for (const s of stops) {
      const key = s.stopDate.toISOString().slice(0, 10);
      if (!locationIdsByDate.has(key)) locationIdsByDate.set(key, new Set());
      locationIdsByDate.get(key)!.add(s.locationId);
      if (s.routeId === null) hasUnassignedByDate.set(key, true);
    }

    const days: Record<string, { count: number; hasUnassigned: boolean }> = {};
    locationIdsByDate.forEach((ids, key) => {
      days[key] = { count: ids.size, hasUnassigned: hasUnassignedByDate.get(key) ?? false };
    });

    return NextResponse.json({ days });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'カレンダー情報の取得に失敗しました' }, { status: 500 });
  }
}
