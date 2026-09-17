import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { startOfDay, endOfDay, subDays, format } from 'date-fns';
import { computeRouteOperationStatus } from '@/lib/routeOperationStatus';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const dateParam = request.nextUrl.searchParams.get('date');
    const selectedDateStr = dateParam ?? format(new Date(), 'yyyy-MM-dd');

    // routeDateは@db.Date（時刻・タイムゾーンを持たない日付のみ）のため、ローカルタイムゾーンの
    // startOfDay/endOfDayを経由すると日本時間との時差でUTC上の日付がずれ、前日分まで混入してしまう。
    // 指定された日付文字列をそのままUTCの日付境界として使う
    const routeDateStart = new Date(`${selectedDateStr}T00:00:00.000Z`);
    const routeDateEnd = new Date(`${selectedDateStr}T23:59:59.999Z`);

    const todayRoutes = await prisma.planRoute.findMany({
      where: { routeDate: { gte: routeDateStart, lte: routeDateEnd } },
      include: {
        truck: true,
        driver: true,
        stops: { include: { location: true }, orderBy: { stopOrder: 'asc' } },
        fuelLogs: true,
        trips: { orderBy: { tripIndex: 'asc' } },
      },
    });

    const routeCount = todayRoutes.length;
    const completedCount = todayRoutes.filter(r => r.status === 'COMPLETED').length;
    const inProgressCount = todayRoutes.filter(
      r => r.status !== 'COMPLETED' && r.stops.some(s => s.status === 'COMPLETED')
    ).length;

    const now = new Date();

    const routeOperationStatus = (route: (typeof todayRoutes)[number]) =>
      computeRouteOperationStatus(route.status, route.stops.some(s => s.status === 'COMPLETED'));

    const routeAttentionScore = (route: (typeof todayRoutes)[number]) => {
      let score = 0;
      if (routeOperationStatus(route) === 'BEFORE_START' && route.departureTime && route.departureTime < now) {
        score += 2;
      }
      // 遅延判定はお客様に約束した到着希望時刻（requestedArrivalTime）と比較する。ルート再計算による
      // 見込み時刻（scheduledTime）は移動時間の都合でずれることがあり、遅延の有無を正しく表さないため使わない
      score += route.stops.filter(
        s => s.isTimeFixed && s.status === 'PENDING' && s.requestedArrivalTime && s.requestedArrivalTime < now
      ).length;
      return score;
    };

    const routeSummaries = todayRoutes.map(r => ({
      id: r.id,
      routeDate: r.routeDate,
      note: r.note,
      stopCount: r.stops.length,
      completedStopCount: r.stops.filter(s => s.status === 'COMPLETED').length,
      driver: r.driver.name,
      truck: r.truck.plateNo,
      routeOperationStatus: routeOperationStatus(r),
      hasFuelLog: r.fuelLogs.length > 0,
      departureTime: r.departureTime,
      returnedAt: r.returnedAt,
      attentionScore: routeAttentionScore(r),
      // 便が2件以上あるルートだけ、停車地に便番号を添える（1便のみ・便を使わないルートでは
      // 表示する意味が無いため、tripIndexをnullのままにしてダッシュボード側で非表示にする）
      destinations: r.stops.map(s => {
        const trip = r.trips.length > 1 && s.tripId ? r.trips.find(t => t.id === s.tripId) : undefined;
        return {
          id: s.id,
          name: s.location.name,
          status: s.status,
          tripIndex: trip ? trip.tripIndex : null,
        };
      }),
    }));

    // 過去7日の完了件数（arrivedAtは時刻付きのタイムスタンプのため、日本時間の暦日で集計する）
    const selectedDayLocalStart = startOfDay(new Date(selectedDateStr));
    const last7days = [];
    for (let i = 6; i >= 0; i--) {
      const day = startOfDay(subDays(selectedDayLocalStart, i));
      const count = await prisma.deliveryStop.count({
        where: {
          status: 'COMPLETED',
          arrivedAt: { gte: day, lte: endOfDay(day) },
        },
      });
      last7days.push({ date: format(day, 'yyyy-MM-dd'), count });
    }

    // ドライバー稼働状況
    const allDrivers = await prisma.driver.findMany({ where: { status: 'ACTIVE' } });
    const routeByDriverId = new Map(todayRoutes.map(r => [r.driverId, r]));

    const driverStatusLabel = (route: (typeof todayRoutes)[number] | undefined): 'IN_PROGRESS' | 'IDLE' | 'COMPLETED' => {
      if (!route) return 'IDLE';
      if (route.status === 'COMPLETED') return 'COMPLETED';
      const hasCompletedStop = route.stops.some(s => s.status === 'COMPLETED');
      if (route.status === 'IN_PROGRESS' || hasCompletedStop) return 'IN_PROGRESS';
      return 'IDLE';
    };

    // 便が2件以上あるルートの「進行中」ドライバーだけ、今何便目かを添える。
    // 完了済み以外の最初の便＝現在対応中（または次に開始する）便とみなす
    // （全便完了していればroute.statusがCOMPLETEDになりこの分岐自体が使われないため、
    // findで見つからない＝該当なしのケースは実際には発生しない想定だが、念のため最後の便で保険を掛ける）
    const currentTripInfo = (route: (typeof todayRoutes)[number] | undefined) => {
      if (!route || route.trips.length <= 1) return null;
      const active = route.trips.find(t => t.status !== 'COMPLETED') ?? route.trips[route.trips.length - 1];
      return { index: active.tripIndex + 1, total: route.trips.length };
    };

    const driverList = allDrivers.map(d => {
      const route = routeByDriverId.get(d.id);
      return {
        id: d.id,
        name: d.name,
        type: d.type,
        status: driverStatusLabel(route),
        truck: route?.truck.plateNo ?? null,
        // 配達完了グループ内で「帰社済み」を示すバッジ表示用
        returnedAt: route?.returnedAt ?? null,
        // 進行中グループ内で「N/M便」を示すバッジ表示用
        currentTrip: currentTripInfo(route),
      };
    });

    const assignedTruckIds = new Set(todayRoutes.map(r => r.truckId));
    const allTrucks = await prisma.truck.findMany({ where: { status: { not: 'RETIRED' } } });
    const unassignedTrucks = allTrucks.filter(t => !assignedTruckIds.has(t.id)).length;

    return NextResponse.json({
      routeCount,
      completedCount,
      inProgressCount,
      last7days,
      drivers: driverList,
      unassignedTrucks,
      totalTrucks: allTrucks.length,
      routes: routeSummaries,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'ダッシュボードデータの取得に失敗しました' }, { status: 500 });
  }
}
