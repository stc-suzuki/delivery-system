'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { LayoutDashboard } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import RefreshButton from '@/components/ui/RefreshButton';
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
  returnEta: string | null;
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
  returnEta: string | null;
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

const AUTO_REFRESH_MS = 30_000;

function todayStr() {
  // toISOString()はUTC基準になり、日本時間の深夜0時〜朝9時台は日付が1日ずれるため使わない
  return format(new Date(), 'yyyy-MM-dd');
}

export default function DashboardPage() {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  // 日付を切り替えた直後に、前の日付の応答が遅れて届いても反映しないため
  const latestDateRef = useRef(date);

  // silent: 自動更新・更新ボタンからの読み直し。表示中の内容を消さずに差し替える
  const load = useCallback(
    async (silent: boolean) => {
      if (silent) setRefreshing(true);
      else setData(null);
      try {
        const res = await fetch(`/api/dashboard?date=${date}`);
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (latestDateRef.current !== date) return;
        setData(json);
        setUpdatedAt(new Date());
        setRefreshFailed(false);
        setError('');
      } catch {
        if (latestDateRef.current !== date) return;
        if (silent) setRefreshFailed(true);
        else setError('データの取得に失敗しました');
      } finally {
        if (silent) setRefreshing(false);
      }
    },
    [date]
  );

  // 進み具合を見張る画面のため、開いたままでも一定間隔で読み直す（別のタブを見ている間は止める）
  useEffect(() => {
    latestDateRef.current = date;
    load(false);
    const timer = setInterval(() => {
      if (!document.hidden) load(true);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [date, load]);

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
            <div className="ml-2 border-l border-blue-200 pl-3">
              <RefreshButton
                onRefresh={() => load(true)}
                refreshing={refreshing}
                updatedAt={updatedAt}
                failed={refreshFailed}
              />
            </div>
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
