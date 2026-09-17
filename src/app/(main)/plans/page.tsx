'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, differenceInCalendarDays } from 'date-fns';
import DispatchGanttChart, { GanttRoute, splitPlateNo } from '@/components/plans/DispatchGanttChart';
import { PlanStatus, RouteStatus } from '@prisma/client';
import { computeRouteOperationStatus, RouteOperationStatus } from '@/lib/routeOperationStatus';

const ROUTE_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5',
  '#0d9488', '#c026d3', '#ca8a04', '#059669', '#be123c',
];

type PlanStop = {
  id: string;
  scheduledTime: string | null;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
  isTimeFixed: boolean;
  location: { name: string };
};
type PlanRoute = {
  id: string;
  status: RouteStatus;
  truck: { plateNo: string };
  driver: { name: string };
  departureTime: string | null;
  stops: PlanStop[];
};
type Plan = {
  id: string;
  planDate: string;
  status: PlanStatus;
  note: string | null;
  routes: PlanRoute[];
};

type SortKey = 'departure' | 'status' | 'truck' | 'driver' | 'stopCount' | 'attention';

const SORT_LABELS: Record<SortKey, string> = {
  departure: '出発時刻順',
  status: '配送状況順',
  truck: 'ナンバー下4桁順',
  driver: 'ドライバー名前順',
  stopCount: '停車件数順',
  attention: '要注意順',
};

const OPERATION_RANK: Record<RouteOperationStatus, number> = {
  BEFORE_START: 0,
  STARTED: 1,
  IN_OPERATION: 2,
  COMPLETED: 3,
};

const driverNameCollator = new Intl.Collator('ja');

function getOperationStatus(route: GanttRoute): RouteOperationStatus {
  return route.routeStatus
    ? computeRouteOperationStatus(route.routeStatus, route.stops.some(s => s.status === 'COMPLETED'))
    : 'BEFORE_START';
}

function getAttentionScore(route: GanttRoute, now: Date): number {
  const departure = route.departureTime ? new Date(route.departureTime) : null;
  let score = 0;
  if (getOperationStatus(route) === 'BEFORE_START' && departure && departure < now) score += 2;
  score += route.stops.filter(
    s => s.isTimeFixed && s.status === 'PENDING' && s.scheduledTime && new Date(s.scheduledTime) < now
  ).length;
  return score;
}

function sortRoutes(routes: GanttRoute[], sortKey: SortKey): GanttRoute[] {
  const now = new Date();
  return [...routes].sort((a, b) => {
    switch (sortKey) {
      case 'status':
        return OPERATION_RANK[getOperationStatus(a)] - OPERATION_RANK[getOperationStatus(b)];
      case 'truck':
        return splitPlateNo(a.truckPlateNo).lastFour.localeCompare(splitPlateNo(b.truckPlateNo).lastFour);
      case 'driver':
        return driverNameCollator.compare(a.driverName, b.driverName);
      case 'stopCount':
        return b.stops.length - a.stops.length;
      case 'attention':
        return getAttentionScore(b, now) - getAttentionScore(a, now);
      case 'departure':
      default: {
        const at = a.departureTime ? new Date(a.departureTime).getTime() : Infinity;
        const bt = b.departureTime ? new Date(b.departureTime).getTime() : Infinity;
        return at - bt;
      }
    }
  });
}

export default function PlansPage() {
  const router = useRouter();
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('departure');

  async function fetchPlans() {
    const res = await fetch(`/api/plans?date=${date}`);
    setPlans(await res.json());
  }

  useEffect(() => {
    fetchPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const ganttRoutes: GanttRoute[] = plans.flatMap(plan =>
    plan.routes.map((r, i) => ({
      id: r.id,
      planId: plan.id,
      planStatus: plan.status,
      routeStatus: r.status,
      truckPlateNo: r.truck.plateNo,
      driverName: r.driver.name,
      color: ROUTE_COLORS[i % ROUTE_COLORS.length],
      departureTime: r.departureTime,
      stops: r.stops.map(s => ({
        id: s.id,
        name: s.location.name,
        scheduledTime: s.scheduledTime,
        status: s.status,
        isTimeFixed: s.isTimeFixed,
      })),
    }))
  );

  const sortedRoutes = sortRoutes(ganttRoutes, sortKey);

  const dayOffset = differenceInCalendarDays(new Date(date), new Date(format(new Date(), 'yyyy-MM-dd')));
  const relativeDayLabel = dayOffset === 0 ? '今日' : dayOffset === 1 ? '明日' : dayOffset === 2 ? '明後日' : null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-800">配送計画一覧</h1>

      <div className="flex items-center gap-3">
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value as SortKey)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
          配送計画（{format(new Date(date), 'yyyy/MM/dd')}）
          {relativeDayLabel === '今日' ? (
            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">{relativeDayLabel}</span>
          ) : (
            relativeDayLabel && <span className="text-xs font-medium text-blue-600">{relativeDayLabel}</span>
          )}
        </h2>
        {plans.length > 0 && (
          <p className="mb-2 text-xs text-gray-500">各配送計画をクリックすると、その配送計画を編集できます。</p>
        )}
        {plans.length === 0 ? (
          <p className="text-sm text-gray-500">この日付の計画はありません</p>
        ) : (
          <DispatchGanttChart
            routes={sortedRoutes}
            onRouteClick={route => route.planId && router.push(`/plans/${route.planId}`)}
          />
        )}
      </div>
    </div>
  );
}
