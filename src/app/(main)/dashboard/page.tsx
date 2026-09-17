'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { LayoutDashboard } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import KpiCards from '@/components/dashboard/KpiCards';
import DriverStatusTable from '@/components/dashboard/DriverStatusTable';
import PlanSummaryList from '@/components/dashboard/PlanSummaryList';
import type { RouteOperationStatus } from '@/lib/routeOperationStatus';

type Destination = {
  id: string;
  name: string;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
  tripIndex: number | null;
};

type RouteSummary = {
  id: string;
  routeDate: string;
  note: string | null;
  stopCount: number;
  completedStopCount: number;
  driver: string;
  truck: string;
  routeOperationStatus: RouteOperationStatus;
  hasFuelLog: boolean;
  departureTime: string | null;
  returnedAt: string | null;
  attentionScore: number;
  destinations: Destination[];
};

type DriverRow = {
  id: string;
  name: string;
  type: 'FIXED_ROUTE' | 'REGULAR' | 'SALES';
  status: 'IN_PROGRESS' | 'IDLE' | 'COMPLETED';
  truck: string | null;
  returnedAt: string | null;
  currentTrip: { index: number; total: number } | null;
};

type DashboardData = {
  routeCount: number;
  completedCount: number;
  inProgressCount: number;
  last7days: { date: string; count: number }[];
  drivers: DriverRow[];
  unassignedTrucks: number;
  totalTrucks: number;
  routes: RouteSummary[];
};

function todayStr() {
  // toISOString()はUTC基準になり、日本時間の深夜0時〜朝9時台は日付が1日ずれるため使わない
  return format(new Date(), 'yyyy-MM-dd');
}

export default function DashboardPage() {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    fetch(`/api/dashboard?date=${date}`)
      .then(res => res.json())
      .then(setData)
      .catch(() => setError('データの取得に失敗しました'));
  }, [date]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-gray-500">読み込み中...</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LayoutDashboard}
        title="ダッシュボード"
        description="本日の配送状況をひと目で確認できます。"
        tint="blue"
        action={
          <div className="flex items-center gap-2">
            <label htmlFor="dashboard-date" className="text-sm text-gray-600">表示日付</label>
            <input
              id="dashboard-date"
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            />
            {date && (
              <p className="text-[22px] font-semibold text-gray-800">
                {date.slice(5, 7)}/{date.slice(8, 10)}
              </p>
            )}
            {date !== todayStr() && (
              <button
                onClick={() => setDate(todayStr())}
                className="text-sm text-blue-600 hover:underline"
              >
                今日に戻す
              </button>
            )}
          </div>
        }
      />
      <KpiCards
        routeCount={data.routeCount}
        completedCount={data.completedCount}
        inProgressCount={data.inProgressCount}
        unassignedTrucks={data.unassignedTrucks}
        totalTrucks={data.totalTrucks}
      />
      <DriverStatusTable drivers={data.drivers} />
      <PlanSummaryList routes={data.routes} />
    </div>
  );
}
