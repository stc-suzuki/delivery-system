'use client';

import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import PlanStatusBadge from '@/components/plans/PlanStatusBadge';
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

const DESTINATION_STYLES: Record<Destination['status'], string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  COMPLETED: 'bg-green-100 text-green-700',
  SKIPPED: 'bg-orange-100 text-orange-700',
};

const DESTINATION_LABELS: Record<Destination['status'], string> = {
  PENDING: '未完了',
  COMPLETED: '完了',
  SKIPPED: 'スキップ',
};

export default function PlanSummaryList({ plans }: { plans: PlanSummary[] }) {
  const router = useRouter();

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-gray-800">本日の配送計画</h2>
      {plans.length === 0 && (
        <p className="text-sm text-gray-500">本日の配送計画はありません</p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map(plan => {
          const progress = plan.stopCount === 0 ? 0 : Math.round((plan.completedStopCount / plan.stopCount) * 100);
          return (
            <div
              key={plan.id}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:shadow"
            >
              <button
                onClick={() => router.push(`/plans/${plan.id}`)}
                className="w-full text-left"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">{format(new Date(plan.planDate), 'yyyy/MM/dd')}</span>
                  <PlanStatusBadge status={plan.status} />
                </div>
                <p className="text-sm text-gray-600">ルート数: {plan.routeCount}</p>
                <p className="text-sm text-gray-600">
                  停車地: {plan.completedStopCount} / {plan.stopCount} 完了
                </p>
                <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100">
                  <div
                    className="h-1.5 rounded-full bg-blue-600"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                {plan.drivers.length > 0 && (
                  <p className="mt-2 truncate text-xs text-gray-500">
                    ドライバー: {plan.drivers.join(', ')}
                  </p>
                )}
                {plan.note && <p className="mt-1 truncate text-xs text-gray-400">{plan.note}</p>}
              </button>

              {plan.destinations.length > 0 && (
                <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto border-t border-gray-100 pt-2">
                  {plan.destinations.map(dest => (
                    <li key={dest.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-gray-700">{dest.name}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${DESTINATION_STYLES[dest.status]}`}>
                        {DESTINATION_LABELS[dest.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
