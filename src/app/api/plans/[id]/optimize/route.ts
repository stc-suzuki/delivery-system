import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canEditRoute, getEditHorizonDays } from '@/lib/planEditPolicy';
import { orderWithTimeBudget, estimateStopTimes, skipLunchBreak, addTimeOutsideLunch, travelTimeMs, travelModelFromSettings } from '@/lib/routeOptimizer';
import { validatePackagesInput, MAX_STOPS_PER_ROUTE, PackageInput } from '@/lib/planValidation';
import { checkCapacityOverflow, effectiveCapacityM3, fitsBed, truckBed } from '@/lib/loadCapacity';
import { fetchCurrentPositions } from '@/lib/currentPosition';

const toHHMM = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** 容積・サイズチェックだけに使う寸法情報。DBから読んだ既存Package（productIdがnullableなPrisma型）もこれで受けられる */
type PackageDims = { name: string; width: number; depth: number; height: number };

function sumPackageVolume(pkgs: PackageDims[]): number {
  return pkgs.reduce((sum, p) => sum + p.width * p.depth * p.height, 0);
}

// SIZE_OVERチェック（案C：警告のみ）
function buildSizeOverWarnings(
  truckLabel: string,
  bed: { width: number; depth: number; height: number } | null,
  items: { stopName: string; packages: PackageDims[] }[]
): string[] {
  if (!bed) return [];
  const warnings: string[] = [];
  for (const item of items) {
    for (const pkg of item.packages) {
      if (!fitsBed(pkg, bed)) {
        warnings.push(
          `${truckLabel}: 「${pkg.name}」（${item.stopName}・${pkg.width}×${pkg.depth}×${pkg.height}m）が荷台サイズに入りません`
        );
      }
    }
  }
  return warnings;
}

// 稼働中（または完了）のルートに対する差分更新のみを行う。完了・スキップ済み停車地は保持したまま、
// 未配達分のみを現在地から並べ直す。[id]はルートID（トラック1台分）。
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const route = await prisma.planRoute.findUnique({
      where: { id: params.id },
      include: {
        stops: { include: { location: true, packages: true }, orderBy: { stopOrder: 'asc' } },
        trips: { orderBy: { tripIndex: 'asc' } },
      },
    });
    if (!route) {
      return NextResponse.json({ error: '配送ルートが見つかりません' }, { status: 404 });
    }
    if (!canEditRoute(route, await getEditHorizonDays())) {
      return NextResponse.json({ error: 'このルートは編集できません' }, { status: 403 });
    }
    // 完了済み（COMPLETED）ルートへの配送先追加も許可する（2026-08-24決定）。帰社の途中・後を問わず、
    // 稼働開始後の追加という点でIN_PROGRESSと同じ扱いにするため、ここでは弾かない

    const body = await req.json();
    const { locationIds, truckIds, driverIds, arrivalTimes, packages, poolStopIds } = body as {
      locationIds: string[];
      truckIds: string[];
      driverIds: string[];
      arrivalTimes?: Record<string, string>;
      /** 配送先ID → 荷物一覧（荷物マスタ）。積載割当の容積・サイズチェック（案C・警告のみ）に使用。
       *  キーが存在しない配送先は既存の荷物データを変更しない */
      packages?: Record<string, PackageInput[]>;
      /** 配送先ID → 荷物受付（プール）の既存停車地ID。指定された配送先は新規作成せず、
       *  この既存停車地（未割当のまま残っているもの）を再利用する（重複停車地の防止） */
      poolStopIds?: Record<string, string>;
    };

    if (!Array.isArray(locationIds) || !Array.isArray(truckIds) || !Array.isArray(driverIds)) {
      return NextResponse.json({ error: 'locationIds, truckIds, driverIds は配列で指定してください' }, { status: 400 });
    }
    // トラック・ドライバーの変更禁止チェック（稼働中は変更不可）
    if (truckIds.length !== 1 || driverIds.length !== 1 || truckIds[0] !== route.truckId || driverIds[0] !== route.driverId) {
      return NextResponse.json({ error: '稼働中はトラック・ドライバーを変更できません' }, { status: 400 });
    }

    const packagesError = await validatePackagesInput(locationIds, packages);
    if (packagesError) {
      return NextResponse.json({ error: packagesError }, { status: 400 });
    }

    const fixedStops = route.stops.filter(s => s.status !== 'PENDING');
    const pendingStops = route.stops.filter(s => s.status === 'PENDING');

    const fixedLocationIds = new Set(fixedStops.map(s => s.locationId));
    if (locationIds.some(id => fixedLocationIds.has(id))) {
      return NextResponse.json(
        { error: 'この配送先は既にこのルートで処理済みです。画面を再読み込みしてください' },
        { status: 400 }
      );
    }

    if (fixedStops.length + locationIds.length > MAX_STOPS_PER_ROUTE) {
      return NextResponse.json(
        { error: `1ルートあたりの停車地は最大${MAX_STOPS_PER_ROUTE}件までです` },
        { status: 400 }
      );
    }

    const pendingByLocationId = new Map(pendingStops.map(s => [s.locationId, s]));
    const newLocationIds = locationIds.filter(id => !pendingByLocationId.has(id));

    // プール（荷物受付）由来の配送先は、新規作成せず既存の停車地を再利用する（重複停車地の防止）
    const poolStopIdEntries = newLocationIds
      .map(id => (poolStopIds?.[id] ? ([id, poolStopIds[id]] as const) : null))
      .filter((e): e is readonly [string, string] => e !== null);
    const poolStopsForReuse = poolStopIdEntries.length > 0
      ? await prisma.deliveryStop.findMany({
          where: { id: { in: poolStopIdEntries.map(([, stopId]) => stopId) } },
          include: { location: true, packages: true },
        })
      : [];
    const poolStopById = new Map(poolStopsForReuse.map(s => [s.id, s]));
    const poolStopByLocationId = new Map<string, (typeof poolStopsForReuse)[number]>();
    for (const [locationId, stopId] of poolStopIdEntries) {
      const stop = poolStopById.get(stopId);
      if (
        !stop ||
        stop.locationId !== locationId ||
        stop.routeId !== null ||
        stop.stopDate.getTime() !== route.routeDate.getTime()
      ) {
        return NextResponse.json(
          { error: '選択した配送先は既に割り当てられているか、削除されています。画面を再読み込みしてください' },
          { status: 400 }
        );
      }
      poolStopByLocationId.set(locationId, stop);
    }

    const remainingNewLocationIds = newLocationIds.filter(id => !poolStopByLocationId.has(id));
    const newLocationsForRoute = remainingNewLocationIds.length > 0
      ? await prisma.location.findMany({ where: { id: { in: remainingNewLocationIds } } })
      : [];
    if (newLocationsForRoute.length !== remainingNewLocationIds.length) {
      return NextResponse.json({ error: '指定された配送先が見つかりません' }, { status: 400 });
    }

    // リクエストから外れた（チェックが外された）未処理の停車地は、削除せず未割当（プール）へ戻す。
    // 荷物受付で登録された荷物データを誤って消さないため（/api/stops/[stopId]の未割当解除と同じ方針）
    const requestedIds = new Set(locationIds);
    const toUnassign = pendingStops.filter(s => !requestedIds.has(s.locationId));
    const maxFixedOrder = fixedStops.length > 0 ? Math.max(...fixedStops.map(s => s.stopOrder)) : -1;

    const settings = await prisma.systemSetting.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });
    const depot = { lat: settings.depotLat, lng: settings.depotLng };

    // 現在地: 「既に本社へ帰社済み」の実績 > 最新の位置情報 > 直近の配達済み地点（実際の完了時刻
    // basedで判定。計画順（stopOrder）通りに配達しているとは限らないため、stopOrderではなく
    // arrivedAt（実際に完了操作をした時刻）が最も新しいものを選ぶ） > 車庫。
    // 帰社実績（直近の便のreturnedAt）が記録済みの場合、トラックは既に物理的に車庫にいるはずなので、
    // GPS・配達完了地点より優先して車庫を現在地とする。以前はこの実績を一切見ておらず、帰社済みでも
    // 直近の配達完了地点（お客様先）が現在地とみなされ、そこから車庫までの移動時間を余計に加算して
    // しまうバグがあった。ルートは常に便を1件以上持つ不変条件のため、常に最後の便のreturnedAtを見る
    // 決め方は荷物受付の当日の見込みと共通（currentPosition.ts）
    const currentPos = (await fetchCurrentPositions(prisma, [route.id], depot)).get(route.id)!;

    const routeDateBase = new Date(route.routeDate);
    const [lunchStartHour, lunchStartMinute] = settings.lunchBreakStart.split(':').map(Number);
    const lunchStart = new Date(routeDateBase);
    lunchStart.setHours(lunchStartHour, lunchStartMinute, 0, 0);
    const [lunchEndHour, lunchEndMinute] = settings.lunchBreakEnd.split(':').map(Number);
    const lunchEnd = new Date(routeDateBase);
    lunchEnd.setHours(lunchEndHour, lunchEndMinute, 0, 0);
    const lunchBreak = lunchEnd.getTime() > lunchStart.getTime() ? { start: lunchStart, end: lunchEnd } : undefined;

    const now = new Date();

    type RouteCombined = {
      id: string;
      locationId: string;
      name: string;
      lat: number;
      lng: number;
      arrivalTime: string | null;
      /** リクエストで新たに指定された荷物一覧。undefinedなら既存の荷物データを変更しない */
      packagesToSync: PackageInput[] | undefined;
      /** 容積・サイズチェックに使う実効的な荷物一覧（新規指定 or 既存データ） */
      effectivePackages: PackageDims[];
      isExisting: boolean;
      /** このルートに新規追加される停車地か（＝稼働開始後に「配送先の割当」で追加した分）。
       *  trueの場合のみDeliveryStop.addedAfterDepartureを立てる */
      isNewToRoute: boolean;
    };
    const routeCombined: RouteCombined[] = locationIds.map(id => {
      const existing = pendingByLocationId.get(id);
      if (existing) {
        const arrivalOverride = arrivalTimes ? arrivalTimes[id] : undefined;
        const arrivalTime =
          arrivalOverride !== undefined
            ? arrivalOverride
            : existing.requestedArrivalTime
            ? existing.requestedArrivalTime.toISOString()
            : null;
        const packagesToSync = packages?.[id];
        return {
          id: existing.id,
          locationId: id,
          name: existing.location.name,
          lat: existing.location.lat,
          lng: existing.location.lng,
          arrivalTime,
          packagesToSync,
          effectivePackages: packagesToSync ?? existing.packages,
          isExisting: true,
          isNewToRoute: false,
        };
      }
      const poolStop = poolStopByLocationId.get(id);
      if (poolStop) {
        const arrivalOverride = arrivalTimes ? arrivalTimes[id] : undefined;
        const arrivalTime =
          arrivalOverride !== undefined
            ? arrivalOverride
            : poolStop.requestedArrivalTime
            ? poolStop.requestedArrivalTime.toISOString()
            : null;
        const packagesToSync = packages?.[id];
        return {
          id: poolStop.id,
          locationId: id,
          name: poolStop.location.name,
          lat: poolStop.location.lat,
          lng: poolStop.location.lng,
          arrivalTime,
          packagesToSync,
          effectivePackages: packagesToSync ?? poolStop.packages,
          isExisting: true,
          isNewToRoute: true,
        };
      }
      const location = newLocationsForRoute.find(l => l.id === id)!;
      const newPackages = packages?.[id] ?? [];
      return {
        id: location.id,
        locationId: id,
        name: location.name,
        lat: location.lat,
        lng: location.lng,
        arrivalTime: arrivalTimes?.[id] ?? null,
        packagesToSync: newPackages,
        effectivePackages: newPackages,
        isExisting: false,
        isNewToRoute: true,
      };
    });

    // 便を使うルートの「現在開いている（COMPLETEDでない）便」と、その便が実際に1件でも
    // 進んでいるか（COMPLETED/SKIPPEDの停車地が1件でもあるか）を調べる。追加→未割当に戻す→
    // 再追加、を繰り返すと、その都度「開いている便を完了にして新しい便を作る」を実行してしまい、
    // 実際には一度も出発していない空の便が完了扱いで積み上がり、追加のたびに本社帰着＋積み込み時間
    // （既定30分）が積算されてガントチャート上でどんどん時間が後ろにずれる不具合があった。
    // 便が1件も進んでいない（＝まだ本社を出発してすらいない）場合は、新しい便を作らずその便を
    // そのまま使い回し、本社経由（帰着＋積み込み）の再計算自体を行わない
    const openTrip = [...route.trips].sort((a, b) => b.tripIndex - a.tripIndex).find(t => t.status !== 'COMPLETED');
    const openTripHasProgress = openTrip
      ? route.stops.some(s => s.tripId === openTrip.id && s.status !== 'PENDING')
      : false;
    const reuseOpenTripWithoutDepotCycle = !!openTrip && !openTripHasProgress;

    // 新規の配送先が追加される場合、ドライバーは一旦本社に戻ってから荷物を積み込んで
    // 再出発する運用のため、現在地から本社までの移動時間＋積み込み所要時間を挟んでから
    // 並べ直す。既存の未処理停車地を並べ替えるだけ（新規追加なし）の場合はこの限りではない
    const warnings: string[] = [];
    let startPos = currentPos;
    let startTime = now;
    // 複数便対応フェーズ5：新規追加のたびに本社経由が発生するたび、その到着時刻を直前の便の
    // 帰着実績として使う（トランザクション内の便作成・便クローズ処理で参照するため外側で保持する）
    let arrivalAtDepotForTrip: Date | null = null;
    if (newLocationIds.length > 0 && reuseOpenTripWithoutDepotCycle) {
      // まだ何も進んでいない便を使い回すだけなので、本社経由の積み込みサイクルは発生させない
      startPos = depot;
      startTime =
        openTrip!.departureTime && openTrip!.departureTime.getTime() > now.getTime() ? openTrip!.departureTime : now;
    } else if (newLocationIds.length > 0) {
      const travelToDepotMs = travelTimeMs(currentPos, depot, travelModelFromSettings(settings));
      const reloadMs = settings.reloadDurationMinutes * 60 * 1000;
      // 昼休みは運転も積み込みも止めて休む。本社へ戻る途中・積み込みの途中で昼休みに入れば、
      // 休憩明けに残りを済ませる（estimateStopTimesの各レッグと同じ手順）
      const arrivalAtDepot = skipLunchBreak(addTimeOutsideLunch(now, travelToDepotMs, lunchBreak), lunchBreak);
      arrivalAtDepotForTrip = arrivalAtDepot;
      startPos = depot;
      startTime = addTimeOutsideLunch(arrivalAtDepot, reloadMs, lunchBreak);
      warnings.push(
        `新しい配送先の追加のため、一旦本社に戻って積み込んでから出発する前提（積み込み時間${settings.reloadDurationMinutes}分を含む）で到着予定時刻を再計算しました`
      );
    }

    const travel = travelModelFromSettings(settings);
    const ordered = orderWithTimeBudget(startPos, startTime, routeCombined, lunchBreak, travel);
    const timed = estimateStopTimes(startPos, startTime, ordered, lunchBreak, settings.defaultStopDurationMinutes, travel);

    timed.forEach(stop => {
      if (stop.timeConflict) {
        warnings.push(
          `${stop.name}: 希望到着時刻 ${toHHMM(new Date(stop.arrivalTime as string))} には移動時間の都合で間に合わない可能性があります（推定到着 ${toHHMM(stop.estimatedTime)}）`
        );
      }
    });

    // 積載容積・サイズチェック（案C：警告のみ）。完了済みは荷降ろし済みでトラックから外れているため対象外。
    // スキップ済みは配達できず持ち帰りのため、トラックに積まれたままとみなして対象に含める。
    // ただし「持ち帰り」は今回対象にしている便（＝これから走る便）に限る。新しい便を作る場合
    // （下のtargetTripIdがnull）、古い便のスキップ分は本社帰着時に荷降ろし・仕分けされる前提のため
    // 新しい便の容量計算には含めない（便をまたいで積み残しが際限なく積算されるのを防ぐ）
    const truck = await prisma.truck.findUnique({ where: { id: route.truckId } });
    const targetTripId =
      newLocationIds.length > 0 && !reuseOpenTripWithoutDepotCycle ? null : openTrip?.id ?? null;
    const remainingStops = targetTripId
      ? fixedStops.filter(s => s.status !== 'COMPLETED' && s.tripId === targetTripId)
      : [];
    const stopVolumes = [
      ...remainingStops.map(s => sumPackageVolume(s.packages)),
      ...timed.map(stop => sumPackageVolume(stop.effectivePackages)),
    ];
    // 積み込み時の隙間を見込み、容積上限×積載利用率（システム設定）を上限として判定する
    const capacityLimit = effectiveCapacityM3(truck?.capacityM3, settings.loadUtilizationPercent);
    const capacityCheck = checkCapacityOverflow(capacityLimit, stopVolumes);
    if (capacityCheck.overCapacity && capacityLimit != null) {
      const utilizationNote = settings.loadUtilizationPercent < 100 ? `・積載利用率${settings.loadUtilizationPercent}%` : '';
      warnings.push(
        `${truck?.plateNo ?? route.truckId}: 積載体積が上限を超えている可能性があります（合計${capacityCheck.totalVolume.toFixed(2)}m3 / 上限${capacityLimit.toFixed(2)}m3${utilizationNote}）`
      );
    }
    warnings.push(
      ...buildSizeOverWarnings(truck?.plateNo ?? route.truckId, truckBed(truck), [
        ...remainingStops.map(s => ({ stopName: s.location.name, packages: s.packages })),
        ...timed.map(stop => ({ stopName: stop.name, packages: stop.effectivePackages })),
      ])
    );

    const updatedRoute = await prisma.$transaction(async tx => {
      // 複数便対応フェーズ5：新規追加のたびに「便」を1つ作り、直前の便（あれば）を完了にする。
      // どの停車地を残しどう並べ替えるかというロジック（fixedStops/routeCombined）自体は変更せず、
      // routeCombinedの全停車地をそのまま新しい便としてtripIdでまとめるだけの追加処理
      let newTripId: string | null = null;
      if (newLocationIds.length > 0 && reuseOpenTripWithoutDepotCycle) {
        // まだ1件も進んでいない便をそのまま使い回す（新しい便を作らず、閉じもしない）
        newTripId = openTrip!.id;
        if (openTrip!.departureTime?.getTime() !== startTime.getTime()) {
          await tx.routeTrip.update({ where: { id: openTrip!.id }, data: { departureTime: startTime } });
        }
      } else if (newLocationIds.length > 0 && arrivalAtDepotForTrip) {
        // ルートは常に便を1件以上持つ不変条件のため、直近の未完了便（＝現在進行中のはず。ここに
        // 来るのはopenTripが実際に1件でも進んでいた場合のみ）だけを完了にして次の便を作ればよい。
        // fixedStopsは既に正しいtripIdを持っているのでここでは触らない
        if (openTrip) {
          await tx.routeTrip.update({
            where: { id: openTrip.id },
            data: { status: 'COMPLETED', returnedAt: arrivalAtDepotForTrip },
          });
        }
        const nextTripIndex = Math.max(...route.trips.map(t => t.tripIndex)) + 1;
        const newTrip = await tx.routeTrip.create({
          data: { routeId: route.id, tripIndex: nextTripIndex, status: 'IN_PROGRESS', departureTime: startTime },
        });
        newTripId = newTrip.id;
      }

      for (const stop of toUnassign) {
        // 未割当（プール）に戻す際は、ルート計算による見込み時刻のズレを、
        // お客様への到着希望時刻に戻しておく（/api/stops/[stopId]の未割当解除と同じ方針）
        await tx.deliveryStop.update({
          where: { id: stop.id },
          data: { routeId: null, tripId: null, hasTimeConflict: false, scheduledTime: stop.requestedArrivalTime },
        });
      }

      for (let i = 0; i < timed.length; i++) {
        const item = timed[i];
        const stopOrder = maxFixedOrder + 1 + i;
        if (item.isExisting) {
          await tx.deliveryStop.update({
            where: { id: item.id },
            data: {
              // プール（routeId未設定）由来の停車地をここで取り込む場合に必要。
              // 既にこのルートに属する停車地では常に同じ値なので無害
              routeId: route.id,
              stopOrder,
              requestedArrivalTime: item.arrivalTime ? new Date(item.arrivalTime) : null,
              scheduledTime: item.estimatedTime,
              isTimeFixed: !!item.arrivalTime,
              hasTimeConflict: item.timeConflict,
              // 稼働開始後にこのルートへ新規追加された場合のみ立てる。既にこのルートにあった
              // 停車地（isNewToRoute: false）では触らず、既存の値（false）を維持する
              ...(item.isNewToRoute ? { addedAfterDeparture: true } : {}),
              // 複数便対応フェーズ5：新しい便が作られた回（newLocationIds.length > 0）だけ、
              // 今回まとめて並べ直した停車地全員（既存の未処理分も含む）をその便に付け替える
              ...(newTripId ? { tripId: newTripId } : {}),
            },
          });
          if (item.packagesToSync !== undefined) {
            await tx.package.deleteMany({ where: { stopId: item.id } });
            if (item.packagesToSync.length > 0) {
              await tx.package.createMany({
                data: item.packagesToSync.map(p => ({ stopId: item.id, productId: p.productId, name: p.name, width: p.width, depth: p.depth, height: p.height })),
              });
            }
          }
        } else {
          const createdStop = await tx.deliveryStop.create({
            data: {
              stopDate: route.routeDate,
              routeId: route.id,
              tripId: newTripId,
              locationId: item.locationId,
              stopOrder,
              requestedArrivalTime: item.arrivalTime ? new Date(item.arrivalTime) : null,
              scheduledTime: item.estimatedTime,
              isTimeFixed: !!item.arrivalTime,
              hasTimeConflict: item.timeConflict,
              addedAfterDeparture: true,
            },
          });
          if (item.packagesToSync && item.packagesToSync.length > 0) {
            await tx.package.createMany({
              data: item.packagesToSync.map(p => ({ stopId: createdStop.id, productId: p.productId, name: p.name, width: p.width, depth: p.depth, height: p.height })),
            });
          }
        }
      }

      // 全停車地解決済みならルートを完了にする（/api/tracking/stops/[id]と同じロジック）
      const finalStops = await tx.deliveryStop.findMany({ where: { routeId: route.id } });
      const allStopsResolved =
        finalStops.length > 0 && finalStops.every(s => s.status === 'COMPLETED' || s.status === 'SKIPPED');
      if (allStopsResolved && route.status !== 'COMPLETED') {
        await tx.planRoute.update({ where: { id: route.id }, data: { status: 'COMPLETED' } });
      }
      if (allStopsResolved) {
        // 複数便対応フェーズ5：全停車地解決済みになったタイミングで、まだ完了していない便
        // （＝最後の便）も合わせて完了にする（tracking/stops/[id]と同じ安全策）。
        // ただし停車地が現在1件も無い便（＝プールに戻す等で空になっただけの便）は対象外にする。
        // 含めてしまうと、まだ一度も出発していない空の便まで「完了」扱いになり、次に配送先を
        // 追加したときに再利用されず必ず新しい便が作られてしまう（本社帰着＋積み込み時間が
        // 追加のたびに積算され、ガントチャート上の時間がどんどん後ろにずれる不具合の原因だった）
        // returnedAtも併せて記録する（tracking/stops/[id]と同じ理由。設定し忘れるとこの便が
        // 実際には本社に戻っているのにガントチャート上「帰着予定」のまま表示され続けてしまう）
        await tx.routeTrip.updateMany({
          where: { routeId: route.id, status: { not: 'COMPLETED' }, stops: { some: {} } },
          data: { status: 'COMPLETED', returnedAt: new Date() },
        });
      }
      if (!allStopsResolved && route.status === 'COMPLETED') {
        // 完了済みルートに新しい配送先が追加され、未処理の停車地が生じた場合はIN_PROGRESSへ戻す。
        // 帰社記録（returnedAt）もこの新しい分がまだ残っている以上正しくなくなるためリセットする
        // （配り終えて改めて帰社した時点で、ドライバーに再度「帰社」を押してもらう）
        await tx.planRoute.update({ where: { id: route.id }, data: { status: 'IN_PROGRESS', returnedAt: null } });
      }

      return tx.planRoute.findUniqueOrThrow({
        where: { id: route.id },
        include: {
          truck: true,
          driver: true,
          stops: { orderBy: { stopOrder: 'asc' }, include: { location: true, packages: true } },
          trips: { orderBy: { tripIndex: 'asc' } },
        },
      });
    });

    return NextResponse.json({ route: updatedRoute, warnings });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'ルート最適化に失敗しました' }, { status: 500 });
  }
}
