'use client';

import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import PlanStatusBadge from '@/components/plans/PlanStatusBadge';
import { splitPlateNo } from '@/components/plans/DispatchGanttChart';
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
  routeStatuses: RouteOperationStatus[];
  destinations: Destination[];
};

type RouteOperationStatus = 'BEFORE_START' | 'STARTED' | 'IN_OPERATION' | 'COMPLETED';

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

const ROUTE_STATUS_STYLES: Record<RouteOperationStatus, string> = {
  BEFORE_START: 'bg-gray-100 text-gray-600',
  STARTED: 'bg-orange-100 text-orange-700',
  IN_OPERATION: 'bg-yellow-100 text-yellow-800',
  COMPLETED: 'bg-green-100 text-green-700',
};

const ROUTE_STATUS_LABELS: Record<RouteOperationStatus, string> = {
  BEFORE_START: '稼働前',
  STARTED: '運送開始',
  IN_OPERATION: '稼働中',
  COMPLETED: '運送完了',
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
          const isCompleted = plan.status === 'COMPLETED';
          return (
            <div
              key={plan.id}
              className={
                isCompleted
                  ? 'rounded-lg border border-green-200 border-l-4 border-l-green-500 bg-green-50 p-4 shadow-sm hover:shadow'
                  : 'rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:shadow'
              }
            >
              <button
                onClick={() => router.push(`/plans/${plan.id}`)}
                className="w-full text-left"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">{format(new Date(plan.planDate), 'yyyy/MM/dd')}</span>
                  <PlanStatusBadge status={plan.status} />
                </div>
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
                  <div className="mt-2 space-y-1">
                    {plan.drivers.map((driver, i) => {
                      const truck = plan.trucks[i];
                      const routeStatus = plan.routeStatuses[i];
                      const { prefix, lastFour } = truck ? splitPlateNo(truck) : { prefix: '', lastFour: '' };
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-base font-bold text-gray-800">
                            {driver}
                            {lastFour && (
                              <span className="ml-1 text-base font-bold text-gray-800">
                                {prefix && <span className="text-xs font-normal text-gray-500">{prefix}</span>}
                                {lastFour}
                              </span>
                            )}
                          </span>
                          {routeStatus && (
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ROUTE_STATUS_STYLES[routeStatus]}`}>
                              {ROUTE_STATUS_LABELS[routeStatus]}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
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
