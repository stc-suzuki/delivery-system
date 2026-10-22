import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { validatePackagesInput, PackageInput } from '@/lib/planValidation';
import { computeDayTimeOverflow, DayRouteInput } from '@/lib/dayTimeOverflow';
import { PoolStopInput } from '@/lib/loadAssignment';
import { fetchCurrentPositions } from '@/lib/currentPosition';

// 配送先・荷物のプール登録（日付スコープ、配送ルートに非依存）。
// 未割当（routeId未設定）の停車地に加え、既に手動割当済み（routeId設定済み）の停車地も
// 参照用に返す（画面側で割当済み/未割当を区別して表示するため）。
// 更新・削除はrouteId未設定の行のみを対象とし、割当済みの停車地には一切触れない。
//
// PUTは「その日のリストを丸ごと置き換える」方式をやめ、実際に触った行だけを
// add/update/removeとして送ってもらう差分方式にしている（2026-08-20）。
// 複数人が同時にこの画面を開いた場合でも、自分が触っていない他人の追加分を
// 誤って消してしまうことがない。update/removeは対象行のversionを照合し、
// 自分が読み込んだ時点から他人に更新されていれば拒否する（楽観ロック）。

type PoolAddItem = { locationId: string; arrivalTime?: string | null; packages?: PackageInput[] };
type PoolUpdateItem = { stopId: string; version: number; arrivalTime?: string | null; packages?: PackageInput[] };
type PoolRemoveItem = { stopId: string; version: number };
type NotSavedEntry = { locationName: string; reason: string };

function parseDateParam(dateStr: string | null): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export async function GET(req: NextRequest) {
  const dateStr = req.nextUrl.searchParams.get('date');
  const stopDate = parseDateParam(dateStr);
  if (!stopDate) {
    return NextResponse.json({ error: 'date は YYYY-MM-DD 形式で指定してください' }, { status: 400 });
  }

  const [stops, routesForDate, systemSetting] = await Promise.all([
    prisma.deliveryStop.findMany({
      where: { stopDate },
      include: {
        location: true,
        packages: true,
        route: { include: { truck: true, driver: true } },
      },
      orderBy: { id: 'asc' },
    }),
    // その日の容積超過・時間超過チェック用：その日にルートが存在する全トラック。
    // 台数が同じ日に複数ルートを持つことは想定していないが、念のためtruckIdで重複排除する
    prisma.planRoute.findMany({
      where: { routeDate: stopDate },
      select: {
        id: true,
        truckId: true,
        driverId: true,
        departureTime: true,
        status: true,
        truck: { select: { plateNo: true, capacityM3: true, bedWidth: true, bedDepth: true, bedHeight: true } },
      },
    }),
    prisma.systemSetting.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } }),
  ]);

  // 当日の出発済みトラックは、今いる場所から見込む（dayTimeOverflow.ts）
  const currentPositions = await fetchCurrentPositions(
    prisma,
    routesForDate.filter(r => r.status !== 'PENDING').map(r => r.id),
    { lat: systemSetting.depotLat, lng: systemSetting.depotLng }
  );

  const unassignedStops = stops.filter(s => s.routeId === null);
  const assignedStops = stops.filter(s => s.routeId !== null);

  const capacityByTruckId = new Map(routesForDate.map(r => [r.truckId, r.truck.capacityM3]));
  const setCapacities = Array.from(capacityByTruckId.values()).filter((v): v is number => v != null);
  // 複数便対応：1台＝1回の積み込みで1日分を配りきる前提ではなくなったため、トラック容量の
  // 単純合計ではなく「1日あたりの想定往復回数」を掛けた値をその日の実効容量とする
  const assumedTripsPerDay = systemSetting.assumedTripsPerDay;
  const totalM3 = setCapacities.reduce((sum, v) => sum + v, 0) * assumedTripsPerDay;
  const loadUtilizationPercent = systemSetting.loadUtilizationPercent;
  const truckCapacity = {
    totalM3,
    effectiveM3: totalM3 * (loadUtilizationPercent / 100),
    loadUtilizationPercent,
    assumedTripsPerDay,
    truckCount: capacityByTruckId.size,
    uncappedTruckCount: capacityByTruckId.size - setCapacities.length,
  };

  // 時間超過チェック：既に割当済み（完了除く）の停車地＋未割当プールをFFDで仮に振り分けた場合、
  // 定時（deliveryEndTime）までに配りきれるトラックがあるか
  const routeInputsByTruckId = new Map<string, DayRouteInput>();
  for (const r of routesForDate) {
    if (routeInputsByTruckId.has(r.truckId)) continue;
    routeInputsByTruckId.set(r.truckId, {
      truckId: r.truckId,
      driverId: r.driverId,
      plateNo: r.truck.plateNo,
      capacityM3: r.truck.capacityM3,
      bedWidth: r.truck.bedWidth,
      bedDepth: r.truck.bedDepth,
      bedHeight: r.truck.bedHeight,
      departureTime: r.departureTime,
      assignedStops: [],
      status: r.status,
      currentPos: currentPositions.get(r.id),
    });
  }
  for (const s of assignedStops) {
    if (s.status === 'COMPLETED') continue;
    const truckId = s.route?.truck.id;
    const entry = truckId ? routeInputsByTruckId.get(truckId) : undefined;
    if (!entry) continue;
    entry.assignedStops.push({
      id: s.id,
      name: s.location.name,
      lat: s.location.lat,
      lng: s.location.lng,
      arrivalTime: s.requestedArrivalTime ? s.requestedArrivalTime.toISOString() : null,
      packages: s.packages,
    });
  }
  const poolStopInputs: PoolStopInput[] = unassignedStops.map(s => ({
    id: s.id,
    name: s.location.name,
    lat: s.location.lat,
    lng: s.location.lng,
    arrivalTime: s.requestedArrivalTime ? s.requestedArrivalTime.toISOString() : null,
    packages: s.packages,
  }));

  const timeOverflowResult = computeDayTimeOverflow(Array.from(routeInputsByTruckId.values()), poolStopInputs, {
    routeDate: stopDate,
    defaultDepartureTime: systemSetting.defaultDepartureTime,
    lunchBreakStart: systemSetting.lunchBreakStart,
    lunchBreakEnd: systemSetting.lunchBreakEnd,
    defaultStopDurationMinutes: systemSetting.defaultStopDurationMinutes,
    deliveryEndTime: systemSetting.deliveryEndTime,
    loadUtilizationPercent,
    reloadDurationMinutes: systemSetting.reloadDurationMinutes,
    depotLat: systemSetting.depotLat,
    depotLng: systemSetting.depotLng,
    averageSpeedKmh: systemSetting.averageSpeedKmh,
    roadDetourFactor: systemSetting.roadDetourFactor,
    perLegTravelMinutes: systemSetting.perLegTravelMinutes,
    now: new Date(),
  });
  const finishTimes = timeOverflowResult.truckResults.map(r => r.finishTime).filter((t): t is Date => t != null);
  const timeOverflow = {
    overCapacityTime: timeOverflowResult.overCapacityTime,
    deliveryEndTime: systemSetting.deliveryEndTime,
    latestFinishTime: finishTimes.length > 0 ? new Date(Math.max(...finishTimes.map(t => t.getTime()))).toISOString() : null,
    // 時間指定に間に合わない見込みの配送先（同じ時間帯の指定が重なってトラックが足りない場合など）。
    // 割当済みは今のトラック、未割当は上の仮の振り分けで判定した結果
    arrivalConflicts: timeOverflowResult.arrivalConflictStopIds.flatMap(id => {
      const s = stops.find(st => st.id === id);
      return s?.requestedArrivalTime ? [{ stopId: s.id, locationName: s.location.name, requestedArrivalTime: s.requestedArrivalTime.toISOString() }] : [];
    }),
  };

  return NextResponse.json({ unassignedStops, assignedStops, truckCapacity, timeOverflow });
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const actorName = session?.user?.name ?? null;

    const body = await req.json();
    const {
      date,
      add = [],
      update = [],
      remove = [],
    } = body as { date: string; add?: PoolAddItem[]; update?: PoolUpdateItem[]; remove?: PoolRemoveItem[] };

    const stopDate = parseDateParam(date);
    if (!stopDate) {
      return NextResponse.json({ error: 'date は YYYY-MM-DD 形式で指定してください' }, { status: 400 });
    }
    if (!Array.isArray(add) || !Array.isArray(update) || !Array.isArray(remove)) {
      return NextResponse.json({ error: 'add / update / remove は配列で指定してください' }, { status: 400 });
    }

    const addPackagesByLocationId = Object.fromEntries(add.map(it => [it.locationId, it.packages ?? []]));
    const addPackagesError = await validatePackagesInput(add.map(it => it.locationId), addPackagesByLocationId);
    if (addPackagesError) {
      return NextResponse.json({ error: addPackagesError }, { status: 400 });
    }
    const updatePackagesByStopId = Object.fromEntries(update.map(it => [it.stopId, it.packages ?? []]));
    const updatePackagesError = await validatePackagesInput(update.map(it => it.stopId), updatePackagesByStopId);
    if (updatePackagesError) {
      return NextResponse.json({ error: updatePackagesError }, { status: 400 });
    }

    const addLocationIds = add.map(it => it.locationId);
    let addLocations: { id: string; name: string }[] = [];
    if (addLocationIds.length > 0) {
      addLocations = await prisma.location.findMany({ where: { id: { in: addLocationIds } } });
      if (addLocations.length !== new Set(addLocationIds).size) {
        return NextResponse.json({ error: '指定された配送先が見つかりません' }, { status: 400 });
      }
    }
    const locationNameById = new Map(addLocations.map(l => [l.id, l.name]));

    // add対象の配送先について、その日に既に停車地（未割当・割当済み問わず）が
    // ないかを確認する。あれば新規作成せずスキップする（重複防止。分割により
    // 未割当が複数ある配送先も、この画面からの新規追加では対象にしない）
    const existingForAdd =
      addLocationIds.length > 0
        ? await prisma.deliveryStop.findMany({ where: { stopDate, locationId: { in: addLocationIds } } })
        : [];
    const existingForAddByLocationId = new Map<string, typeof existingForAdd>();
    for (const s of existingForAdd) {
      const arr = existingForAddByLocationId.get(s.locationId) ?? [];
      arr.push(s);
      existingForAddByLocationId.set(s.locationId, arr);
    }

    // update/remove対象は、行そのもの（stopId）を直接指定してもらう。同じ配送先を
    // 複数の停車地（分割済み）が指しても、行単位で操作するので曖昧さが生じない
    const touchedStopIds = [...update.map(u => u.stopId), ...remove.map(r => r.stopId)];
    const touchedStops =
      touchedStopIds.length > 0
        ? await prisma.deliveryStop.findMany({ where: { id: { in: touchedStopIds } }, include: { location: true } })
        : [];
    const touchedStopById = new Map(touchedStops.map(s => [s.id, s]));

    const notSaved: NotSavedEntry[] = [];

    // 画面は保存のあと必ず最新の内容を読み込み直すため、利用者に再読み込みは求めない
    // （「画面は最新の内容に更新されています」の案内は画面側でダイアログの下にまとめて出す）
    const conflictReason = (updatedByName: string | null, action: '更新' | '削除'): string =>
      `${updatedByName ? `${updatedByName}さん` : '他の人'}が先に${action}していたため、この配送先の変更は保存されませんでした`;

    for (const item of add) {
      const locationName = locationNameById.get(item.locationId) ?? item.locationId;
      const existing = existingForAddByLocationId.get(item.locationId) ?? [];
      if (existing.length > 0) {
        const assigned = existing.find(s => s.routeId !== null);
        if (assigned) {
          notSaved.push({ locationName, reason: '既にトラックへ割当済みのため、この画面からの新規登録をスキップしました' });
        } else {
          const who = existing[0].updatedByName;
          notSaved.push({
            locationName,
            reason: who ? `${who}さんが既に登録したため、重複登録をスキップしました` : '既に登録されているため、重複登録をスキップしました',
          });
        }
        continue;
      }

      const pkgs = item.packages ?? [];
      if (pkgs.length === 0) {
        notSaved.push({ locationName, reason: '荷物が登録されていないため保存されませんでした' });
        continue;
      }

      await prisma.$transaction(async tx => {
        const created = await tx.deliveryStop.create({
          data: {
            stopDate,
            routeId: null,
            locationId: item.locationId,
            stopOrder: 0,
            requestedArrivalTime: item.arrivalTime ? new Date(item.arrivalTime) : null,
            scheduledTime: item.arrivalTime ? new Date(item.arrivalTime) : null,
            isTimeFixed: !!item.arrivalTime,
            version: 0,
            updatedByName: actorName,
          },
        });
        await tx.package.createMany({
          data: pkgs.map(p => ({ stopId: created.id, productId: p.productId, name: p.name, width: p.width, depth: p.depth, height: p.height })),
        });
      });
    }

    for (const item of update) {
      const existing = touchedStopById.get(item.stopId);
      const locationName = existing?.location.name ?? item.stopId;
      if (!existing) {
        notSaved.push({ locationName, reason: 'この配送先は既に削除されていたため、変更は保存されませんでした' });
        continue;
      }
      if (existing.routeId !== null) {
        notSaved.push({ locationName, reason: '既にトラックへ割当済みのため、この画面から変更できませんでした' });
        continue;
      }

      const pkgs = item.packages ?? [];
      if (pkgs.length === 0) {
        // 荷物を全て削除して保存した場合は、運ぶものがない停車地になってしまうため停車地ごと削除する
        const result = await prisma.deliveryStop.deleteMany({ where: { id: item.stopId, version: item.version, routeId: null } });
        if (result.count === 0) {
          notSaved.push({ locationName, reason: conflictReason(existing.updatedByName, '更新') });
        } else {
          notSaved.push({ locationName, reason: '荷物が登録されていないため削除されました' });
        }
        continue;
      }

      const result = await prisma.deliveryStop.updateMany({
        where: { id: item.stopId, version: item.version, routeId: null },
        data: {
          requestedArrivalTime: item.arrivalTime ? new Date(item.arrivalTime) : null,
          scheduledTime: item.arrivalTime ? new Date(item.arrivalTime) : null,
          isTimeFixed: !!item.arrivalTime,
          version: { increment: 1 },
          updatedByName: actorName,
        },
      });
      if (result.count === 0) {
        notSaved.push({ locationName, reason: conflictReason(existing.updatedByName, '更新') });
        continue;
      }
      await prisma.package.deleteMany({ where: { stopId: item.stopId } });
      await prisma.package.createMany({
        data: pkgs.map(p => ({ stopId: item.stopId, productId: p.productId, name: p.name, width: p.width, depth: p.depth, height: p.height })),
      });
    }

    for (const item of remove) {
      const existing = touchedStopById.get(item.stopId);
      if (!existing) continue; // 既に無い（誰かが先に削除済み）なら何もしない
      const locationName = existing.location.name;
      if (existing.routeId !== null) {
        notSaved.push({ locationName, reason: '既にトラックへ割当済みのため削除できませんでした' });
        continue;
      }
      const result = await prisma.deliveryStop.deleteMany({ where: { id: item.stopId, version: item.version, routeId: null } });
      if (result.count === 0) {
        notSaved.push({ locationName, reason: conflictReason(existing.updatedByName, '更新') });
      }
    }

    return NextResponse.json({ notSaved });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'プールの保存に失敗しました' }, { status: 500 });
  }
}
