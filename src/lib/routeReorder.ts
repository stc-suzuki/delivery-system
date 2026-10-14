import { Prisma } from '@prisma/client';
import { skipLunchBreak, LunchBreak, Coord } from './routeOptimizer';
import { planTrips } from './tripPlanning';

type Tx = Prisma.TransactionClient;

export function resolveDeparture(planDate: Date, routeDepartureTime: Date | null, defaultDepartureTime: string): Date {
  const d = new Date(planDate);
  if (routeDepartureTime) {
    d.setHours(routeDepartureTime.getHours(), routeDepartureTime.getMinutes(), 0, 0);
  } else {
    const [h, m] = defaultDepartureTime.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
}

// 停車地の割当が変わったルートの並び順・推定時刻を再計算して永続化する。
// assign-suggested / stops/[stopId] の両エンドポイントから共通で利用する。
export async function reorderRoute(tx: Tx, routeId: string): Promise<{ warnings: string[] }> {
  const route = await tx.planRoute.findUniqueOrThrow({
    where: { id: routeId },
    include: {
      stops: { include: { location: true } },
      trips: { orderBy: { tripIndex: 'asc' } },
    },
  });

  if (route.stops.length === 0) {
    return { warnings: [] };
  }

  const routeDate = route.routeDate;

  const settings = await tx.systemSetting.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });

  const departureDefault = resolveDeparture(routeDate, route.departureTime, settings.defaultDepartureTime);

  const [lunchStartHour, lunchStartMinute] = settings.lunchBreakStart.split(':').map(Number);
  const lunchStart = new Date(routeDate);
  lunchStart.setHours(lunchStartHour, lunchStartMinute, 0, 0);
  const [lunchEndHour, lunchEndMinute] = settings.lunchBreakEnd.split(':').map(Number);
  const lunchEnd = new Date(routeDate);
  lunchEnd.setHours(lunchEndHour, lunchEndMinute, 0, 0);
  const lunchBreak: LunchBreak | undefined =
    lunchEnd.getTime() > lunchStart.getTime() ? { start: lunchStart, end: lunchEnd } : undefined;

  const depot: Coord = { lat: settings.depotLat, lng: settings.depotLng };
  const locationById = new Map(route.stops.map(s => [s.id, s.location.name]));
  const warnings: string[] = [];

  // ルートは常に便（RouteTrip）を1件以上持つ不変条件のため、常に便単位で計算する。
  // 停車地をtripIdでグループ化し、tripPlanning.tsのplanTrips()で
  // 「本社→便1→本社→積み込み→本社→便2→…」の時刻列を計算する
  // （便が1件しかないルートでも、単一の連続ルートと同じ結果になる）
  const stopsByTripId = new Map<string, typeof route.stops>();
  for (const trip of route.trips) {
    stopsByTripId.set(trip.id, []);
  }
  for (const stop of route.stops) {
    if (!stop.tripId || !stopsByTripId.has(stop.tripId)) continue;
    stopsByTripId.get(stop.tripId)!.push(stop);
  }

  const tripsStops = route.trips.map(trip =>
    (stopsByTripId.get(trip.id) ?? []).map(stop => ({
      id: stop.id,
      lat: stop.location.lat,
      lng: stop.location.lng,
      arrivalTime: stop.requestedArrivalTime ? stop.requestedArrivalTime.toISOString() : null,
    }))
  );

  const { trips: plannedTrips } = planTrips(
    depot,
    departureDefault,
    tripsStops,
    settings.reloadDurationMinutes,
    lunchBreak,
    settings.defaultStopDurationMinutes
  );

  let stopOrder = 0;
  for (let tripIdx = 0; tripIdx < route.trips.length; tripIdx++) {
    const trip = route.trips[tripIdx];
    const planned = plannedTrips[tripIdx];

    // returnedAtは書き込まない（PlanRoute.returnedAtと同じ扱い：実際に本社へ戻った実績のみが入る値とし、
    // 計画段階の見込み値では汚さない。見込みの帰着時刻はGanttチャート側がestimateReturnToDepotTimeで
    // その場で再計算する。ここでplanned.returnedAtまで書いてしまうと、まだ完了していない便でも
    // returnedAtが埋まってしまい、「実績があるかどうか」の判定が壊れる）
    await tx.routeTrip.update({
      where: { id: trip.id },
      data: { departureTime: planned.departureTime },
    });

    for (const item of planned.stops) {
      if (item.timeConflict) {
        warnings.push(
          `${locationById.get(item.id)}: 希望到着時刻には移動時間の都合で間に合わない可能性があります（推定到着 ${item.estimatedTime.getHours()}:${String(item.estimatedTime.getMinutes()).padStart(2, '0')}）`
        );
      }
      await tx.deliveryStop.update({
        where: { id: item.id },
        data: {
          stopOrder: stopOrder++,
          scheduledTime: item.estimatedTime,
          isTimeFixed: !!item.arrivalTime,
          hasTimeConflict: item.timeConflict,
        },
      });
    }
  }

  return { warnings };
}

// 便を完了して本社へ戻った直後に、まだ開始していない後続の便の出発・到着予定時刻を
// 実際の帰着時刻を起点に再計算する。reorderRoute（上記）は常に「デフォルトの出発時刻」から
// 全便を計画し直すため、既に完了した便が予定より早く・遅く終わっても後続便の時刻はズレたまま
// 残ってしまい、配送計画一覧のガントチャート上で前後の便が時間的に重なって表示される不具合が
// あった（例：1便が予定より2時間遅れて本社に戻ったのに、2便は元の予定時刻のまま＝1便がまだ
// 走っている時間帯に2便の停車地が表示される）。この関数は完了済みの便には一切触れず、
// 完了した便より後の便だけを、実際の帰着時刻＋積み込み時間（reloadDurationMinutes、昼休みに
// かかる場合は休憩明けまで繰り下げ）を新たな起点として計画し直す
export async function rescheduleFollowingTrips(
  tx: Tx,
  routeId: string,
  completedTripIndex: number,
  actualReturnedAt: Date
): Promise<{ warnings: string[] }> {
  const route = await tx.planRoute.findUniqueOrThrow({
    where: { id: routeId },
    include: {
      stops: { include: { location: true } },
      trips: { orderBy: { tripIndex: 'asc' } },
    },
  });

  const remainingTrips = route.trips.filter(t => t.tripIndex > completedTripIndex);
  if (remainingTrips.length === 0) {
    return { warnings: [] };
  }

  const settings = await tx.systemSetting.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });

  const [lunchStartHour, lunchStartMinute] = settings.lunchBreakStart.split(':').map(Number);
  const lunchStart = new Date(route.routeDate);
  lunchStart.setHours(lunchStartHour, lunchStartMinute, 0, 0);
  const [lunchEndHour, lunchEndMinute] = settings.lunchBreakEnd.split(':').map(Number);
  const lunchEnd = new Date(route.routeDate);
  lunchEnd.setHours(lunchEndHour, lunchEndMinute, 0, 0);
  const lunchBreak: LunchBreak | undefined =
    lunchEnd.getTime() > lunchStart.getTime() ? { start: lunchStart, end: lunchEnd } : undefined;

  const depot: Coord = { lat: settings.depotLat, lng: settings.depotLng };
  const locationById = new Map(route.stops.map(s => [s.id, s.location.name]));

  // 実際に本社へ戻った時刻（過去の実績）はそのまま起点にし、そこに積み込み時間を足した
  // 「次の便の出発時刻」だけが昼休みにかかるかどうかをチェックする
  // （optimize/route.tsの本社経由ロジックと同じ「到着→昼休みチェック→積み込み→出発→昼休みチェック」の手順）
  const reloadMs = settings.reloadDurationMinutes * 60 * 1000;
  const nextDepartureTime = skipLunchBreak(new Date(actualReturnedAt.getTime() + reloadMs), lunchBreak);

  const stopsByTripId = new Map<string, typeof route.stops>();
  for (const trip of remainingTrips) {
    stopsByTripId.set(trip.id, []);
  }
  for (const stop of route.stops) {
    if (!stop.tripId || !stopsByTripId.has(stop.tripId)) continue;
    stopsByTripId.get(stop.tripId)!.push(stop);
  }

  const tripsStops = remainingTrips.map(trip =>
    (stopsByTripId.get(trip.id) ?? []).map(stop => ({
      id: stop.id,
      lat: stop.location.lat,
      lng: stop.location.lng,
      arrivalTime: stop.requestedArrivalTime ? stop.requestedArrivalTime.toISOString() : null,
    }))
  );

  const { trips: plannedTrips } = planTrips(
    depot,
    nextDepartureTime,
    tripsStops,
    settings.reloadDurationMinutes,
    lunchBreak,
    settings.defaultStopDurationMinutes
  );

  const warnings: string[] = [];
  const remainingTripIds = new Set(remainingTrips.map(t => t.id));
  // 完了済み（またはそれ以前の）便の停車地数を、後続便のstopOrderの続きとして使う
  let stopOrder = route.stops.filter(s => !s.tripId || !remainingTripIds.has(s.tripId)).length;

  for (let i = 0; i < remainingTrips.length; i++) {
    const trip = remainingTrips[i];
    const planned = plannedTrips[i];
    await tx.routeTrip.update({
      where: { id: trip.id },
      data: { departureTime: planned.departureTime },
    });

    for (const item of planned.stops) {
      if (item.timeConflict) {
        warnings.push(
          `${locationById.get(item.id)}: 希望到着時刻には移動時間の都合で間に合わない可能性があります（推定到着 ${item.estimatedTime.getHours()}:${String(item.estimatedTime.getMinutes()).padStart(2, '0')}）`
        );
      }
      await tx.deliveryStop.update({
        where: { id: item.id },
        data: {
          stopOrder: stopOrder++,
          scheduledTime: item.estimatedTime,
          isTimeFixed: !!item.arrivalTime,
          hasTimeConflict: item.timeConflict,
        },
      });
    }
  }

  return { warnings };
}
