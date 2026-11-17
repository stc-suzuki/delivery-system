import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { validatePackagesInput, PackageInput } from '@/lib/planValidation';
import { candidateDates, evaluateAvailabilityDay, resolveArrivalChoice, ArrivalChoice } from '@/lib/poolAvailability';
import { loadPoolDays } from '@/lib/poolDayData';

// 荷物受付「登録内容の確認・修正」：受け付けた1件の修正（荷物・到着の指定・配送日）と取り消し（2026-11-17導入）。
// トラックに割当済みの停車地は修正できない（今までと同じ。配送管理者が配送計画の画面で未割当に戻してから）。
// 読み込んだ時点のversionと照合し、他の人が先に変えていれば拒否する（楽観ロック、/api/poolと同じ）。
// 修正後の内容で、新規の受付と同じ判定（修正中の停車地自身を除いた状態に足せるか）をし、×なら保存しない

export async function PATCH(req: NextRequest, { params }: { params: { stopId: string } }) {
  try {
    const session = await getServerSession(authOptions);
    const actorName = session?.user?.name ?? null;
    const body = await req.json();
    const { version, date, packages, arrival } = body as {
      version?: number;
      date?: string;
      packages?: PackageInput[];
      arrival?: ArrivalChoice;
    };

    if (typeof version !== 'number') {
      return NextResponse.json({ error: 'version を指定してください' }, { status: 400 });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date は YYYY-MM-DD 形式で指定してください' }, { status: 400 });
    }
    if (!Array.isArray(packages) || packages.length === 0) {
      return NextResponse.json({ error: '荷物を1件以上入れてください' }, { status: 400 });
    }

    const stop = await prisma.deliveryStop.findUnique({ where: { id: params.stopId }, include: { location: true } });
    if (!stop) {
      return NextResponse.json({ error: 'この受付は既に取り消されています' }, { status: 404 });
    }
    if (stop.routeId !== null) {
      return NextResponse.json({ error: '既にトラックへ割当済みのため、修正できません' }, { status: 409 });
    }
    if (stop.version !== version) {
      return NextResponse.json(
        { error: `${stop.updatedByName ? `${stop.updatedByName}さん` : '他の人'}が先に変更していたため、保存されませんでした` },
        { status: 409 }
      );
    }
    const packagesError = await validatePackagesInput([stop.locationId], { [stop.locationId]: packages });
    if (packagesError) {
      return NextResponse.json({ error: packagesError }, { status: 400 });
    }
    const choice = resolveArrivalChoice(date, arrival);
    if ('error' in choice) {
      return NextResponse.json({ error: choice.error }, { status: 400 });
    }

    const now = new Date();
    const settings = await prisma.systemSetting.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
    if (!candidateDates(now, settings.truckScheduleHorizonDays, settings.excludeWeekendsAndHolidays).includes(date)) {
      return NextResponse.json({ error: 'この日は受付できる期間の外です' }, { status: 400 });
    }

    // 修正中の停車地自身を除いた状態に、修正後の内容を足せるか（新規の受付と同じ判定）
    const [day] = await loadPoolDays(prisma, [date], settings, stop.id);
    const { cells } = evaluateAvailabilityDay(day, settings, now, {
      locationId: stop.locationId,
      lat: stop.location.lat,
      lng: stop.location.lng,
      packages,
      mode: choice.mode,
      time: choice.time,
    });
    const cell = cells.find(c => c.key === choice.columnKey);
    if (!cell || (cell.status !== 'ok' && cell.status !== 'tight')) {
      return NextResponse.json({ error: 'この内容では受け付けられません', reason: cell?.reason ?? null, status: cell?.status ?? null }, { status: 409 });
    }

    const updated = await prisma.$transaction(async tx => {
      const result = await tx.deliveryStop.updateMany({
        where: { id: stop.id, version, routeId: null },
        data: {
          stopDate: new Date(`${date}T00:00:00.000Z`),
          requestedArrivalTime: choice.requestedArrivalTime,
          requestedWindowStart: choice.windowStart,
          requestedWindowEnd: choice.windowEnd,
          scheduledTime: choice.requestedArrivalTime,
          isTimeFixed: !!choice.requestedArrivalTime,
          version: { increment: 1 },
          updatedByName: actorName,
        },
      });
      if (result.count === 0) return false;
      await tx.package.deleteMany({ where: { stopId: stop.id } });
      await tx.package.createMany({
        data: packages.map(p => ({ stopId: stop.id, productId: p.productId, name: p.name, width: p.width, depth: p.depth, height: p.height })),
      });
      return true;
    });
    if (!updated) {
      return NextResponse.json({ error: '他の人が先に変更していたため、保存されませんでした' }, { status: 409 });
    }
    return NextResponse.json({ status: cell.status, arrival: cell.arrival, finishTime: cell.finishTime });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '受付の修正に失敗しました' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { stopId: string } }) {
  try {
    const version = Number(req.nextUrl.searchParams.get('version'));
    if (!Number.isInteger(version)) {
      return NextResponse.json({ error: 'version を指定してください' }, { status: 400 });
    }
    const stop = await prisma.deliveryStop.findUnique({ where: { id: params.stopId } });
    if (!stop) return NextResponse.json({ ok: true }); // 既に無い（誰かが先に取り消した）
    if (stop.routeId !== null) {
      return NextResponse.json({ error: '既にトラックへ割当済みのため、取り消せません' }, { status: 409 });
    }
    const result = await prisma.deliveryStop.deleteMany({ where: { id: stop.id, version, routeId: null } });
    if (result.count === 0) {
      return NextResponse.json(
        { error: `${stop.updatedByName ? `${stop.updatedByName}さん` : '他の人'}が先に変更していたため、取り消せませんでした` },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '受付の取り消しに失敗しました' }, { status: 500 });
  }
}
