'use client';

import { useEffect, useState } from 'react';
import KpiCards from '@/components/dashboard/KpiCards';
import WeeklyChart from '@/components/dashboard/WeeklyChart';
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
  destinations: Destination[];
};

type DriverRow = {
  id: string;
  name: string;
  type: 'REGULAR' | 'SPOT';
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

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/dashboard')
      .then(res => res.json())
      .then(setData)
      .catch(() => setError('データの取得に失敗しました'));
  }, []);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-gray-500">読み込み中...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-800">ダッシュボード</h1>
      <KpiCards
        planCount={data.planCount}
        completedCount={data.completedCount}
        inProgressCount={data.inProgressCount}
        unassignedTrucks={data.unassignedTrucks}
        totalTrucks={data.totalTrucks}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WeeklyChart data={data.last7days} />
        <DriverStatusTable drivers={data.drivers} />
      </div>
      <PlanSummaryList plans={data.plans} />
    </div>
  );
}
