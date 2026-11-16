import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computeAvailability, AvailabilityRequest } from '@/lib/poolAvailability';

// 荷物受付「新規の受付」：配送先・荷物を足した場合の、日付×到着の指定ごとの○△×（何も保存しない）。
// POSTなのは荷物の一覧を本文で受け取るため（middleware上は一般権限で呼べる区分）
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { locationId, packages, mode, time } = body as {
      locationId?: string;
      packages?: { width: number; depth: number; height: number }[];
      mode?: 'band' | 'time';
      time?: string;
    };
    if (!locationId || typeof locationId !== 'string') {
      return NextResponse.json({ error: '配送先を選んでください' }, { status: 400 });
    }
    if (!Array.isArray(packages) || packages.length === 0) {
      return NextResponse.json({ error: '荷物を1件以上入れてください' }, { status: 400 });
    }
    if (!packages.every(p => [p.width, p.depth, p.height].every(v => typeof v === 'number' && v > 0))) {
      return NextResponse.json({ error: '荷物の寸法が正しくありません' }, { status: 400 });
    }
    if (mode !== 'band' && mode !== 'time') {
      return NextResponse.json({ error: 'mode は band か time で指定してください' }, { status: 400 });
    }
    if (mode === 'time' && !(typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
      return NextResponse.json({ error: '到着時刻は HH:mm で指定してください' }, { status: 400 });
    }
    const location = await prisma.location.findUnique({ where: { id: locationId } });
    if (!location) {
      return NextResponse.json({ error: '指定された配送先が見つかりません' }, { status: 400 });
    }
    const request: AvailabilityRequest = {
      locationId,
      lat: location.lat,
      lng: location.lng,
      packages: packages.map(p => ({ width: p.width, depth: p.depth, height: p.height })),
      mode,
      time,
    };
    const days = await computeAvailability(prisma, request, new Date());
    return NextResponse.json({ days });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '空き状況の計算に失敗しました' }, { status: 500 });
  }
}
