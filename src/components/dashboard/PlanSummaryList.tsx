'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { splitPlateNo } from '@/components/plans/DispatchGanttChart';
import FuelIcon from '@/components/icons/FuelIcon';
import { returnStatusOf } from './ReturnStatus';
import {
  RouteOperationStatus,
  ROUTE_OPERATION_STATUS_LABELS as ROUTE_STATUS_LABELS,
  ROUTE_OPERATION_STATUS_STYLES as ROUTE_STATUS_STYLES,
} from '@/lib/routeOperationStatus';

type Destination = {
  id: string;
  name: string;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
  // 便が2件以上あるルートの停車地のみ0始まりのインデックスが入る。それ以外はnull
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
  // 帰社途中（配達完了・帰社ボタン未押下）のルートだけ、本社に着く見込みの時刻が入る
  returnEta: string | null;
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

function sortRoutes(routes: RouteSummary[], sortKey: SortKey): RouteSummary[] {
  return [...routes].sort((a, b) => {
    switch (sortKey) {
      case 'status':
        return OPERATION_RANK[a.routeOperationStatus] - OPERATION_RANK[b.routeOperationStatus];
      case 'truck':
        return splitPlateNo(a.truck).lastFour.localeCompare(splitPlateNo(b.truck).lastFour);
      case 'driver':
        return driverNameCollator.compare(a.driver, b.driver);
      case 'stopCount':
        return b.stopCount - a.stopCount;
      case 'attention':
        return b.attentionScore - a.attentionScore;
      case 'departure':
      default: {
        const at = a.departureTime ? new Date(a.departureTime).getTime() : Infinity;
        const bt = b.departureTime ? new Date(b.departureTime).getTime() : Infinity;
        return at - bt;
      }
    }
  });
}

export default function PlanSummaryList({ routes }: { routes: RouteSummary[] }) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>('departure');
  const sortedRoutes = sortRoutes(routes, sortKey);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-gray-800">本日の配送ルート</h2>
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
      {routes.length === 0 && (
        <p className="text-sm text-gray-500">本日の配送ルートはありません</p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sortedRoutes.map(route => {
          const progress = route.stopCount === 0 ? 0 : Math.round((route.completedStopCount / route.stopCount) * 100);
          const isCompleted = route.routeOperationStatus === 'COMPLETED';
          const cardStyle = isCompleted
            ? 'border-green-200 border-l-4 border-l-green-500 bg-green-50'
            : 'border-panel-line bg-panel';
          const { prefix, lastFour } = splitPlateNo(route.truck);
          return (
            <div
              key={route.id}
              className={`rounded-lg border p-4 shadow-sm hover:shadow ${cardStyle}`}
            >
              <button
                onClick={() => router.push(`/plans/${route.id}`)}
                className="w-full text-left"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{format(new Date(route.routeDate), 'MM/dd')}</span>
                    {route.hasFuelLog && <FuelIcon className="h-4 w-4 text-teal-600" />}
                  </span>
                </div>
                <p className="text-sm text-[#4B5563]">
                  停車地: {route.completedStopCount} / {route.stopCount} 完了
                </p>
                <div className="mt-1 h-1.5 w-full rounded-full bg-panel-line">
                  <div
                    className="h-1.5 rounded-full bg-brand"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-base font-bold text-heading">
                    {route.driver}
                    <span className="ml-1 text-base font-bold text-heading">
                      {prefix && <span className="text-xs font-normal text-[#4B5563]">{prefix}</span>}
                      {lastFour}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ROUTE_STATUS_STYLES[route.routeOperationStatus]}`}>
                    {ROUTE_STATUS_LABELS[route.routeOperationStatus]}
                  </span>
                </div>
                {route.note && <p className="mt-1 truncate text-xs text-[#4B5563]">{route.note}</p>}
              </button>

              {isCompleted && (() => {
                // 配達完了のカードは、帰社途中か帰社済みかをカード幅いっぱいの帯で示す
                const { Icon, label, className } = returnStatusOf(route.returnedAt, route.returnEta);
                return (
                  <div className={`-mx-4 mt-3 flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium ${className}`}>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {label}
                  </div>
                );
              })()}

              {route.destinations.length > 0 && (
                <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto border-t border-gray-100 pt-2">
                  {route.destinations.map(dest => (
                    <li key={dest.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-gray-700">{dest.name}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {typeof dest.tripIndex === 'number' && (
                          // 幅を固定し、右隣の状態バッジの文字数（完了=2文字/未完了=3文字/
                          // スキップ=4文字）で自分の開始位置が左右にずれないようにする
                          // （右揃えのグループ内で右側の幅が変わると、左側の便バッジの位置も
                          // 連動してずれて見えていたのが原因だった）
                          <span className="w-8 shrink-0 px-1.5 py-0.5 text-center text-[10px] font-medium text-gray-500">
                            {dest.tripIndex + 1}便
                          </span>
                        )}
                        <span
                          className={`w-14 shrink-0 rounded-full px-2 py-0.5 text-center font-medium ${DESTINATION_STYLES[dest.status]}`}
                        >
                          {DESTINATION_LABELS[dest.status]}
                        </span>
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
