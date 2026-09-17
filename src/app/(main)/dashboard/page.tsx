'use client';

import { useEffect, useState } from 'react';
import KpiCards from '@/components/dashboard/KpiCards';
import DriverStatusTable from '@/components/dashboard/DriverStatusTable';
import PlanSummaryList from '@/components/dashboard/PlanSummaryList';
import { PlanStatus } from '@prisma/client';

type Destination = {
  id: string;
  name: string;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
};

type PlanSummary = {
  id: string;
  planDate: string;
  status: PlanStatus;
  note: string | null;
  routeCount: number;
  stopCount: number;
  completedStopCount: number;
  drivers: string[];
  trucks: string[];
  routeStatuses: ('BEFORE_START' | 'STARTED' | 'IN_OPERATION' | 'COMPLETED')[];
  hasFuelLog: boolean;
  earliestDepartureTime: string | null;
  attentionScore: number;
  destinations: Destination[];
};

type DriverRow = {
  id: string;
  name: string;
  type: 'FIXED_ROUTE' | 'REGULAR' | 'SALES';
  status: 'IN_PROGRESS' | 'IDLE' | 'COMPLETED';
  truck: string | null;
};

type DashboardData = {
  planCount: number;
  completedCount: number;
  inProgressCount: number;
  last7days: { date: string; count: number }[];
  drivers: DriverRow[];
  unassignedTrucks: number;
  totalTrucks: number;
  plans: PlanSummary[];
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">ダッシュボード</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="dashboard-date" className="text-sm text-gray-600">表示日付</label>
          <input
            id="dashboard-date"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
          {date !== todayStr() && (
            <button
              onClick={() => setDate(todayStr())}
              className="text-sm text-blue-600 hover:underline"
            >
              今日に戻す
            </button>
          )}
        </div>
      </div>
      <KpiCards
        planCount={data.planCount}
        completedCount={data.completedCount}
        inProgressCount={data.inProgressCount}
        unassignedTrucks={data.unassignedTrucks}
        totalTrucks={data.totalTrucks}
      />
      <DriverStatusTable drivers={data.drivers} />
      <PlanSummaryList plans={data.plans} />
    </div>
  );
}
