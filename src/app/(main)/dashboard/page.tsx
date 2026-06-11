'use client';

import { useEffect, useState } from 'react';
import KpiCards from '@/components/dashboard/KpiCards';
import WeeklyChart from '@/components/dashboard/WeeklyChart';
import DriverPieChart from '@/components/dashboard/DriverPieChart';

type DashboardData = {
  planCount: number;
  completedCount: number;
  inProgressCount: number;
  last7days: { date: string; count: number }[];
  driverStatus: { regular: number; spot: number };
  unassignedTrucks: number;
  totalTrucks: number;
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
        <DriverPieChart regular={data.driverStatus.regular} spot={data.driverStatus.spot} />
      </div>
    </div>
  );
}
