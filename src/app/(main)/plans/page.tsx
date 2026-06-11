'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import PlanStatusBadge from '@/components/plans/PlanStatusBadge';
import { PlanStatus } from '@prisma/client';

type Plan = {
  id: string;
  planDate: string;
  status: PlanStatus;
  note: string | null;
  routes: { id: string; truck: { plateNo: string }; driver: { name: string }; stops: unknown[] }[];
};

export default function PlansPage() {
  const router = useRouter();
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [plans, setPlans] = useState<Plan[]>([]);
  const [creating, setCreating] = useState(false);

  async function fetchPlans() {
    const res = await fetch(`/api/plans?date=${date}`);
    setPlans(await res.json());
  }

  useEffect(() => {
    fetchPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planDate: date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/plans/${data.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '作成に失敗しました');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-800">配送計画一覧</h1>

      <div className="flex items-center justify-between">
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          onClick={handleCreate}
          disabled={creating}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {creating ? '作成中...' : '新規計画作成'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.length === 0 && (
          <p className="text-sm text-gray-500">この日付の計画はありません</p>
        )}
        {plans.map(plan => (
          <button
            key={plan.id}
            onClick={() => router.push(`/plans/${plan.id}`)}
            className="rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm hover:shadow"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">{format(new Date(plan.planDate), 'yyyy/MM/dd')}</span>
              <PlanStatusBadge status={plan.status} />
            </div>
            <p className="text-sm text-gray-600">ルート数: {plan.routes.length}</p>
            <p className="text-sm text-gray-600">
              停車地合計: {plan.routes.reduce((sum, r) => sum + r.stops.length, 0)}
            </p>
            {plan.note && <p className="mt-1 truncate text-xs text-gray-400">{plan.note}</p>}
          </button>
        ))}
      </div>
    </div>
  );
}
