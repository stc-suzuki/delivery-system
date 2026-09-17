'use client';

import { format } from 'date-fns';
import PlanStatusBadge from './PlanStatusBadge';
import type { PlanStatus, RouteStatus } from '@prisma/client';
import {
  computeRouteOperationStatus,
  ROUTE_OPERATION_STATUS_LABELS,
  ROUTE_OPERATION_STATUS_STYLES,
} from '@/lib/routeOperationStatus';

const START_HOUR = 8;
const END_HOUR = 17;
const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60;

export type GanttStop = {
  id: string;
  name: string;
  scheduledTime: string | null;
  status?: 'PENDING' | 'COMPLETED' | 'SKIPPED';
  isTimeFixed?: boolean;
};

export type GanttRoute = {
  id: string;
  truckPlateNo: string;
  driverName: string;
  color: string;
  departureTime: string | null;
  stops: GanttStop[];
  planId?: string;
  planStatus?: PlanStatus;
  routeStatus?: RouteStatus;
};

function minutesFromStart(time: string): number {
  const d = new Date(time);
  return (d.getHours() - START_HOUR) * 60 + d.getMinutes();
}

// ナンバープレートの下4桁だけを目立たせ、残り（地名・分類番号・ひらがな）は小さく表示する
export function splitPlateNo(plateNo: string): { prefix: string; lastFour: string } {
  const match = plateNo.match(/^(.*?)(\d{4})$/);
  if (!match) return { prefix: plateNo, lastFour: '' };
  return { prefix: match[1].trim(), lastFour: match[2] };
}

function pct(minutes: number): number {
  return Math.min(100, Math.max(0, (minutes / TOTAL_MINUTES) * 100));
}

const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

type Props = {
  routes: GanttRoute[];
  onRouteClick?: (route: GanttRoute) => void;
};

export default function DispatchGanttChart({ routes, onRouteClick }: Props) {
  if (routes.length === 0) {
    return <p className="text-sm text-gray-500">表示できるルートがありません</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="min-w-[800px]">
        {/* ヘッダー: 時間軸 */}
        <div className="flex border-b border-gray-200">
          <div className="w-40 shrink-0 px-3 py-2 text-xs font-semibold text-gray-500">配車</div>
          <div className="relative flex-1">
            <div className="flex">
              {HOURS.map(h => (
                <div
                  key={h}
                  className="flex-1 border-l border-gray-100 px-1 py-2 text-xs text-gray-500"
                >
                  {h}:00
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ルート行 */}
        {routes.map(route => {
          const validStopTimes = route.stops
            .filter(s => s.scheduledTime)
            .map(s => ({ ...s, minutes: minutesFromStart(s.scheduledTime as string) }));
          const startMinutes = route.departureTime
            ? minutesFromStart(route.departureTime)
            : validStopTimes[0]?.minutes;
          const lastStop = validStopTimes[validStopTimes.length - 1];
          const endMinutes = lastStop?.minutes;
          const completedStopTimes = validStopTimes.filter(s => s.status === 'COMPLETED');
          const completedMinutes = completedStopTimes.length > 0
            ? Math.max(...completedStopTimes.map(s => s.minutes))
            : undefined;

          const { prefix, lastFour } = splitPlateNo(route.truckPlateNo);
          const completedCount = route.stops.filter(s => s.status === 'COMPLETED').length;
          const isCompleted = route.planStatus === 'COMPLETED';
          const isDraft = route.planStatus === 'DRAFT';
          const operationStatus = route.routeStatus && !isDraft
            ? computeRouteOperationStatus(route.routeStatus, route.stops.some(s => s.status === 'COMPLETED'))
            : undefined;

          return (
            <div
              key={route.id}
              className={`flex border-b border-gray-100 last:border-b-0 ${
                isCompleted
                  ? 'border-l-4 border-l-green-500 bg-green-50'
                  : isDraft
                  ? 'border-l-4 border-l-gray-400 bg-gray-100'
                  : ''
              }`}
            >
              <div
                className={`flex w-40 shrink-0 items-center gap-2 px-3 py-3 ${
                  onRouteClick ? 'cursor-pointer hover:bg-green-100/60' : ''
                } ${!isCompleted && onRouteClick ? 'hover:bg-gray-50' : ''}`}
                onClick={onRouteClick ? () => onRouteClick(route) : undefined}
              >
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: route.color }} />
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-xs text-gray-500">
                    {prefix}
                    {lastFour && <span className="ml-1 text-base font-semibold text-gray-800">{lastFour}</span>}
                  </div>
                  <div className="truncate text-xs font-semibold text-gray-700">{route.driverName}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    {route.planStatus && route.planStatus !== 'COMPLETED' && <PlanStatusBadge status={route.planStatus} />}
                    {operationStatus && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ROUTE_OPERATION_STATUS_STYLES[operationStatus]}`}
                      >
                        {ROUTE_OPERATION_STATUS_LABELS[operationStatus]}
                      </span>
                    )}
                    <span className="whitespace-nowrap text-xs font-semibold text-gray-500">
                      {completedCount}/{route.stops.length}件
                    </span>
                  </div>
                </div>
              </div>
              <div className="relative flex-1 py-3" style={{ minHeight: '4.5rem' }}>
                {/* グリッド線 */}
                <div className="absolute inset-0 flex">
                  {HOURS.map(h => (
                    <div key={h} className="flex-1 border-l border-gray-100" />
                  ))}
                </div>

                {/* バー: 完了済み区間は濃く、未完了区間は薄く表示 */}
                {startMinutes !== undefined && endMinutes !== undefined && endMinutes >= startMinutes && (
                  <>
                    <div
                      className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full opacity-30"
                      style={{
                        left: `${pct(startMinutes)}%`,
                        width: `${pct(endMinutes) - pct(startMinutes)}%`,
                        backgroundColor: route.color,
                      }}
                    />
                    {completedMinutes !== undefined && completedMinutes >= startMinutes && (
                      <div
                        className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full"
                        style={{
                          left: `${pct(startMinutes)}%`,
                          width: `${pct(completedMinutes) - pct(startMinutes)}%`,
                          backgroundColor: '#16a34a',
                        }}
                      />
                    )}
                  </>
                )}

                {/* 出発マーカー */}
                {route.departureTime && (
                  <div
                    className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded"
                    style={{ left: `${pct(minutesFromStart(route.departureTime))}%`, backgroundColor: route.color }}
                    title={`出発 ${format(new Date(route.departureTime), 'HH:mm')}`}
                  />
                )}

                {/* 停車地マーカー */}
                {validStopTimes.map((stop, i) => {
                  const shortLabel = stop.name.slice(0, 3);
                  const labelAbove = i % 2 === 1;
                  return (
                    <div
                      key={stop.id}
                      className="group absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-default rounded-full border-2 border-white"
                      style={{
                        left: `${pct(stop.minutes)}%`,
                        backgroundColor:
                          stop.status === 'COMPLETED' ? '#16a34a' : stop.isTimeFixed ? '#dc2626' : route.color,
                      }}
                    >
                      {/* 常時表示の短縮ラベル */}
                      <div
                        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] leading-none ${
                          stop.isTimeFixed ? 'font-semibold text-red-600' : 'text-gray-500'
                        } ${labelAbove ? 'bottom-3' : 'top-3'}`}
                      >
                        {shortLabel}
                      </div>

                      {/* ホバー時の詳細ツールチップ */}
                      <div className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white group-hover:block">
                        {stop.name} {format(new Date(stop.scheduledTime as string), 'HH:mm')}
                        {stop.isTimeFixed && '（時刻指定）'}
                      </div>
                    </div>
                  );
                })}

                {startMinutes === undefined && (
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                    時刻未設定
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
