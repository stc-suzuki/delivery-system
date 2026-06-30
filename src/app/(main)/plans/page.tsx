'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, differenceInCalendarDays } from 'date-fns';
import DispatchGanttChart, { GanttRoute } from '@/components/plans/DispatchGanttChart';
import { PlanStatus } from '@prisma/client';

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

export default function PlansPage() {
  const router = useRouter();
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [plans, setPlans] = useState<Plan[]>([]);

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

  const dayOffset = differenceInCalendarDays(new Date(date), new Date(format(new Date(), 'yyyy-MM-dd')));
  const relativeDayLabel = dayOffset === 0 ? '今日' : dayOffset === 1 ? '明日' : dayOffset === 2 ? '明後日' : null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-800">配送計画一覧</h1>

      <div className="flex items-center">
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
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
            routes={ganttRoutes}
            onRouteClick={route => route.planId && router.push(`/plans/${route.planId}`)}
          />
        )}
      </div>
    </div>
  );
}
