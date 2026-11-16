import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { validatePackagesInput, PackageInput } from '@/lib/planValidation';
import { candidateDates, evaluateAvailabilityDay, AvailabilityRequest } from '@/lib/poolAvailability';
import { loadPoolDays } from '@/lib/poolDayData';
import { TIME_BANDS, bandWindowOnDate } from '@/lib/timeBands';

// 荷物受付「新規の受付」：1件だけ受け付けて保存する（2026-11-16導入）。
// 画面で○△を見てから押すまでの間に他の受付が入ることがあるため、保存の直前にもう一度判定し、
// ×になっていれば保存せず409で理由を返す。×の枠は受け付けない（2026-11-16決定）
type Arrival = { kind: 'none' } | { kind: 'band'; band: string } | { kind: 'time'; time: string };

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const actorName = session?.user?.name ?? null;
    const body = await req.json();
    const { date, locationId, packages, arrival } = body as {
      date?: string;
      locationId?: string;
      packages?: PackageInput[];
      arrival?: Arrival;
    };

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date は YYYY-MM-DD 形式で指定してください' }, { status: 400 });
    }
    if (!locationId || typeof locationId !== 'string') {
      return NextResponse.json({ error: '配送先を選んでください' }, { status: 400 });
    }
    if (!Array.isArray(packages) || packages.length === 0) {
      return NextResponse.json({ error: '荷物を1件以上入れてください' }, { status: 400 });
    }
    const packagesError = await validatePackagesInput([locationId], { [locationId]: packages });
    if (packagesError) {
      return NextResponse.json({ error: packagesError }, { status: 400 });
    }
    const location = await prisma.location.findUnique({ where: { id: locationId } });
    if (!location) {
      return NextResponse.json({ error: '指定された配送先が見つかりません' }, { status: 400 });
    }

    let mode: AvailabilityRequest['mode'] = 'band';
    let time: string | undefined;
    let columnKey = 'NONE';
    let requestedArrivalTime: Date | null = null;
    let windowStart: Date | null = null;
    let windowEnd: Date | null = null;
    if (!arrival || arrival.kind === 'none') {
      columnKey = 'NONE';
    } else if (arrival.kind === 'band') {
      const band = TIME_BANDS.find(b => b.key === arrival.band);
      if (!band) return NextResponse.json({ error: '時間帯の指定が正しくありません' }, { status: 400 });
      columnKey = band.key;
      const w = bandWindowOnDate(date, band);
      windowStart = w.start;
      windowEnd = w.end;
    } else if (arrival.kind === 'time') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(arrival.time)) {
        return NextResponse.json({ error: '到着時刻は HH:mm で指定してください' }, { status: 400 });
      }
      mode = 'time';
      time = arrival.time;
      columnKey = 'TIME';
      requestedArrivalTime = new Date(`${date}T${arrival.time}:00+09:00`);
    } else {
      return NextResponse.json({ error: '到着の指定が正しくありません' }, { status: 400 });
    }

    const now = new Date();
    const settings = await prisma.systemSetting.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
    if (!candidateDates(now, settings.truckScheduleHorizonDays, settings.excludeWeekendsAndHolidays).includes(date)) {
      return NextResponse.json({ error: 'この日は受付できる期間の外です' }, { status: 400 });
    }

    const [day] = await loadPoolDays(prisma, [date], settings);
    const { cells } = evaluateAvailabilityDay(day, settings, now, {
      locationId,
      lat: location.lat,
      lng: location.lng,
      packages,
      mode,
      time,
    });
    const cell = cells.find(c => c.key === columnKey);
    if (!cell || (cell.status !== 'ok' && cell.status !== 'tight')) {
      return NextResponse.json(
        { error: '受け付けられなくなりました', reason: cell?.reason ?? null, status: cell?.status ?? null },
        { status: 409 }
      );
    }

    const created = await prisma.$transaction(async tx => {
      const stop = await tx.deliveryStop.create({
        data: {
          stopDate: new Date(`${date}T00:00:00.000Z`),
          routeId: null,
          locationId,
          stopOrder: 0,
          requestedArrivalTime,
          requestedWindowStart: windowStart,
          requestedWindowEnd: windowEnd,
          scheduledTime: requestedArrivalTime,
          isTimeFixed: !!requestedArrivalTime,
          version: 0,
          updatedByName: actorName,
        },
      });
      await tx.package.createMany({
        data: packages.map(p => ({ stopId: stop.id, productId: p.productId, name: p.name, width: p.width, depth: p.depth, height: p.height })),
      });
      return stop;
    });

    return NextResponse.json({ stopId: created.id, status: cell.status, arrival: cell.arrival, finishTime: cell.finishTime });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '受付の保存に失敗しました' }, { status: 500 });
  }
}
