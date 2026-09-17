'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import PlanStatusBadge from '@/components/plans/PlanStatusBadge';
import { splitPlateNo } from '@/components/plans/DispatchGanttChart';
import FuelIcon from '@/components/icons/FuelIcon';
import { PlanStatus } from '@prisma/client';
import {
  RouteOperationStatus,
  ROUTE_OPERATION_STATUS_LABELS as ROUTE_STATUS_LABELS,
  ROUTE_OPERATION_STATUS_STYLES as ROUTE_STATUS_STYLES,
} from '@/lib/routeOperationStatus';

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
  hasFuelLog: boolean;
  earliestDepartureTime: string | null;
  attentionScore: number;
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

function sortPlans(plans: PlanSummary[], sortKey: SortKey): PlanSummary[] {
  return [...plans].sort((a, b) => {
    switch (sortKey) {
      case 'status': {
        const aRank = Math.min(...a.routeStatuses.map(s => OPERATION_RANK[s]), 3);
        const bRank = Math.min(...b.routeStatuses.map(s => OPERATION_RANK[s]), 3);
        return aRank - bRank;
      }
      case 'truck':
        return splitPlateNo(a.trucks[0] ?? '').lastFour.localeCompare(splitPlateNo(b.trucks[0] ?? '').lastFour);
      case 'driver':
        return driverNameCollator.compare(a.drivers[0] ?? '', b.drivers[0] ?? '');
      case 'stopCount':
        return b.stopCount - a.stopCount;
      case 'attention':
        return b.attentionScore - a.attentionScore;
      case 'departure':
      default: {
        const at = a.earliestDepartureTime ? new Date(a.earliestDepartureTime).getTime() : Infinity;
        const bt = b.earliestDepartureTime ? new Date(b.earliestDepartureTime).getTime() : Infinity;
        return at - bt;
      }
    }
  });
}

export default function PlanSummaryList({ plans }: { plans: PlanSummary[] }) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>('departure');
  const sortedPlans = sortPlans(plans, sortKey);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-gray-800">本日の配送計画</h2>
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value as SortKey)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
      </div>
      {plans.length === 0 && (
        <p className="text-sm text-gray-500">本日の配送計画はありません</p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sortedPlans.map(plan => {
          const progress = plan.stopCount === 0 ? 0 : Math.round((plan.completedStopCount / plan.stopCount) * 100);
          const isCompleted = plan.status === 'COMPLETED';
          const isDraft = plan.status === 'DRAFT';
          const cardStyle = isCompleted
            ? 'border-green-200 border-l-4 border-l-green-500 bg-green-50'
            : isDraft
            ? 'border-gray-300 border-l-4 border-l-gray-400 bg-gray-100'
            : 'border-gray-200 bg-white';
          return (
            <div
              key={plan.id}
              className={`rounded-lg border p-4 shadow-sm hover:shadow ${cardStyle}`}
            >
              <button
                onClick={() => router.push(`/plans/${plan.id}`)}
                className="w-full text-left"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{format(new Date(plan.planDate), 'yyyy/MM/dd')}</span>
                    {plan.hasFuelLog && <FuelIcon className="h-4 w-4 text-teal-600" />}
                  </span>
                  {plan.status !== 'COMPLETED' && <PlanStatusBadge status={plan.status} />}
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
                          {routeStatus && plan.status !== 'DRAFT' && (
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
