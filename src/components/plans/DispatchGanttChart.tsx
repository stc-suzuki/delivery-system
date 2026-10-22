'use client';

import { Fragment, useState } from 'react';
import { format } from 'date-fns';
import { useDialog } from '@/components/ui/DialogProvider';
import type { RouteStatus } from '@prisma/client';
import {
  computeRouteOperationStatus,
  ROUTE_OPERATION_STATUS_LABELS,
  ROUTE_OPERATION_STATUS_STYLES,
} from '@/lib/routeOperationStatus';
import {
  STOP_DURATION_MINUTES,
  TOCHIGI_DEPOT,
  DEFAULT_TRAVEL_MODEL,
  estimateReturnToDepotTime,
  type LunchBreak,
  type TravelModel,
} from '@/lib/routeOptimizer';

const START_HOUR = 8;
// 表示範囲の既定の終端（20時）。複数便対応で実際の便がこれより遅くまで続く場合は、
// 下のestimateChartExtentMinutes/dynamicEndHourにより表示範囲を動的に広げる
const END_HOUR = 20;

export type GanttPackage = { id: string; name: string; width: number; depth: number; height: number };

export type GanttStop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  scheduledTime: string | null;
  // お客様への到着希望時刻そのもの（isTimeFixedの場合のみ）。表示にはscheduledTimeより優先する
  requestedArrivalTime?: string | null;
  status?: 'PENDING' | 'COMPLETED' | 'SKIPPED';
  isTimeFixed?: boolean;
  packages?: GanttPackage[];
  // 稼働開始後に「配送先の割当」で追加された停車地か。trueが1件でもあれば、
  // このルートは本社に一旦戻って積み込んでから再出発する前提で到着予定時刻を計算している
  addedAfterDeparture?: boolean;
  // このルートの中でどの便（RouteTrip）の荷物か。null/未設定＝便を使わない今まで通りの単一ルート扱い
  tripId?: string | null;
};

// 複数便対応フェーズ4：1つのルート（トラック1台分）の中の便。1件以下なら今まで通りの単一連続ルート
export type GanttTrip = {
  id: string;
  tripIndex: number;
  status: RouteStatus;
  departureTime: string | null;
  returnedAt: string | null;
};

export type GanttRoute = {
  id: string;
  truckPlateNo: string;
  driverName: string;
  color: string;
  departureTime: string | null;
  stops: GanttStop[];
  routeStatus?: RouteStatus;
  // ドライバーが「帰社」ボタンを押した実績時刻。設定されていれば、最終配送先からこの時刻までを
  // 完了区間（緑色）として扱い、帰社マーカーの表示も推定から実績に切り替える
  returnedAt?: string | null;
  trips?: GanttTrip[];
};

type Props = {
  routes: GanttRoute[];
  onRouteClick?: (route: GanttRoute) => void;
  // 最後の配送先での荷下ろし時間（分）。バーの終端＝本社帰着予定の計算に使う。
  // 未指定時はデフォルト値（routeOptimizer.STOP_DURATION_MINUTES）を使う
  stopDurationMinutes?: number;
  // 昼休み開始・終了（HH:mm）。バー上の帯表示、および本社帰着予定の計算（昼休みにかかる場合は
  // 休憩明けまで繰り下げる）の両方に使う。未指定時はSystemSettingのデフォルト値（12:00〜13:00）を使う
  lunchBreakStart?: string;
  lunchBreakEnd?: string;
  // 本社（車庫）の座標。バー終端（本社帰着予定）の計算に使う。
  // 未指定時はSystemSetting未取得時のフォールバック値（TOCHIGI_DEPOT）を使う
  depotCenter?: { lat: number; lng: number };
  // 移動時間の見積もり（システム設定の平均時速・回り道係数・1区間の固定時間）。本社帰着予定の
  // 計算に使う。未指定時はSystemSetting未取得時のフォールバック（直線距離÷時速30km）
  travel?: TravelModel;
};

const DEFAULT_LUNCH_BREAK_START = '12:00';
const DEFAULT_LUNCH_BREAK_END = '13:00';

function localMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// referenceDate（そのルートの起点＝通常route.departureTime）と同じ日ならSTART_HOURからの
// 経過分を、日をまたいでいれば日数分（1440分単位）を加算して返す。複数便対応で最後の便の
// 本社帰着が日をまたいで深夜0時台にずれ込むケースがあり、日またぎを考慮せず時・分だけで
// 計算すると翌日0時台が「前日の0時（＝START_HOURより前）」と誤認され負の値になり、
// pct()で0%（チャート左端）にクランプされてバー・マーカーが消えて見える不具合があった
function minutesFromStart(time: string, referenceDate: Date): number {
  const d = new Date(time);
  const dayDiff = Math.round((localMidnight(d) - localMidnight(referenceDate)) / 86400000);
  return dayDiff * 1440 + (d.getHours() - START_HOUR) * 60 + d.getMinutes();
}

// そのルートの時刻計算の基準日（＝1便目の出発日）。route.departureTimeが無い場合は
// 便の出発時刻、それも無ければ最初に時刻が判明している停車地の予定時刻で代用する
function resolveRouteReferenceDate(route: GanttRoute): Date {
  if (route.departureTime) return new Date(route.departureTime);
  const firstTripDeparture = route.trips?.find(t => t.departureTime)?.departureTime;
  if (firstTripDeparture) return new Date(firstTripDeparture);
  const firstStop = route.stops.find(s => s.scheduledTime);
  return firstStop ? new Date(firstStop.scheduledTime as string) : new Date();
}

// "HH:mm"をチャート上の分位置（START_HOURからの経過分）に変換する
function hhmmToMinutesFromStart(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h - START_HOUR) * 60 + m;
}

// 昼休み開始・終了（HH:mm）を、指定した日付のDateとして解決する
function resolveLunchBreak(anchor: Date, lunchBreakStart: string, lunchBreakEnd: string): LunchBreak | undefined {
  const [startH, startM] = lunchBreakStart.split(':').map(Number);
  const [endH, endM] = lunchBreakEnd.split(':').map(Number);
  const start = new Date(anchor);
  start.setHours(startH, startM, 0, 0);
  const end = new Date(anchor);
  end.setHours(endH, endM, 0, 0);
  if (end.getTime() <= start.getTime()) return undefined;
  return { start, end };
}

// チャートに表示すべき最も遅い時刻（分、START_HOURからの経過）を求める。複数便対応により
// 1台のトラックが1日に何度も往復すると、最後の便が固定の表示範囲（END_HOUR＝20時）を
// 超えて深夜近くまで続くことがある。その場合に表示範囲を広げず固定幅のままだと、pct()の
// クランプで最後の便のバー幅が0%に潰れ、マーカーも右端の1点に重なって実質見えなくなっていた。
// 各ルートの中で最も遅い到着予定の停車地から、実際の描画ロジック（下のroutes.map内）と同じ
// estimateReturnToDepotTime/resolveLunchBreakで本社帰着見込みまで計算し、その最大値を返す
// （複数便のルートでも、時系列で最後に来る停車地は必ず最後の便に属するため、便ごとに
// 繰り返し計算する必要はない）
function estimateChartExtentMinutes(
  routes: GanttRoute[],
  lunchBreakStart: string,
  lunchBreakEnd: string,
  stopDurationMinutes: number,
  depotCenter: { lat: number; lng: number },
  travel: TravelModel
): number {
  let maxMinutes = 0;
  for (const route of routes) {
    const referenceDate = resolveRouteReferenceDate(route);
    if (route.departureTime) maxMinutes = Math.max(maxMinutes, minutesFromStart(route.departureTime, referenceDate));
    for (const trip of route.trips ?? []) {
      if (trip.departureTime) maxMinutes = Math.max(maxMinutes, minutesFromStart(trip.departureTime, referenceDate));
    }
    let latestStop: GanttStop | undefined;
    let latestStopMinutes = -Infinity;
    for (const stop of route.stops) {
      if (!stop.scheduledTime) continue;
      const m = minutesFromStart(stop.scheduledTime, referenceDate);
      if (m > latestStopMinutes) {
        latestStopMinutes = m;
        latestStop = stop;
      }
    }
    if (latestStop) {
      maxMinutes = Math.max(maxMinutes, latestStopMinutes);
      const lastStopTime = new Date(latestStop.scheduledTime as string);
      const lunchBreak = resolveLunchBreak(lastStopTime, lunchBreakStart, lunchBreakEnd);
      const returnDate = estimateReturnToDepotTime(depotCenter, latestStop, lastStopTime, lunchBreak, stopDurationMinutes, travel);
      maxMinutes = Math.max(maxMinutes, minutesFromStart(returnDate.toISOString(), referenceDate));
    }
  }
  return maxMinutes;
}

// ナンバープレートの下4桁だけを目立たせ、残り（地名・分類番号・ひらがな）は小さく表示する
export function splitPlateNo(plateNo: string): { prefix: string; lastFour: string } {
  const match = plateNo.match(/^(.*?)(\d{4})$/);
  if (!match) return { prefix: plateNo, lastFour: '' };
  return { prefix: match[1].trim(), lastFour: match[2] };
}

// 同一商品（商品名・寸法が一致するもの）をまとめ、個数を付けて表示するための集計
function groupPackages(packages: GanttPackage[]): { name: string; width: number; depth: number; height: number; count: number }[] {
  const grouped = new Map<string, { name: string; width: number; depth: number; height: number; count: number }>();
  packages.forEach(p => {
    const key = `${p.name}|${p.width}|${p.depth}|${p.height}`;
    const existing = grouped.get(key);
    if (existing) existing.count += 1;
    else grouped.set(key, { name: p.name, width: p.width, depth: p.depth, height: p.height, count: 1 });
  });
  return Array.from(grouped.values());
}

export default function DispatchGanttChart({
  routes,
  onRouteClick,
  stopDurationMinutes = STOP_DURATION_MINUTES,
  lunchBreakStart = DEFAULT_LUNCH_BREAK_START,
  lunchBreakEnd = DEFAULT_LUNCH_BREAK_END,
  depotCenter = TOCHIGI_DEPOT,
  travel = DEFAULT_TRAVEL_MODEL,
}: Props) {
  const [expandedRouteIds, setExpandedRouteIds] = useState<Set<string>>(new Set());
  const { warnDialog } = useDialog();

  if (routes.length === 0) {
    return <p className="text-sm text-gray-500">表示できるルートがありません</p>;
  }

  // 表示範囲（END_HOUR）は既定で20時までだが、複数便対応でこれを超える便がある場合は
  // 実際に必要な幅まで動的に広げる（超えなければ既定のまま。狭まることはない）
  const chartExtentMinutes = estimateChartExtentMinutes(
    routes,
    lunchBreakStart,
    lunchBreakEnd,
    stopDurationMinutes,
    depotCenter,
    travel
  );
  const dynamicEndHour = Math.max(END_HOUR, START_HOUR + Math.ceil(chartExtentMinutes / 60));
  const totalMinutes = (dynamicEndHour - START_HOUR) * 60;
  const pct = (minutes: number) => Math.min(100, Math.max(0, (minutes / totalMinutes) * 100));
  const HOURS = Array.from({ length: dynamicEndHour - START_HOUR + 1 }, (_, i) => START_HOUR + i);

  // 昼休み帯（全ルート共通・表示範囲外にはみ出す場合はクランプ）
  const lunchStartMinutes = hhmmToMinutesFromStart(lunchBreakStart);
  const lunchEndMinutes = hhmmToMinutesFromStart(lunchBreakEnd);
  const showLunchBand = lunchEndMinutes > 0 && lunchStartMinutes < totalMinutes && lunchEndMinutes > lunchStartMinutes;

  function toggleExpanded(routeId: string) {
    setExpandedRouteIds(prev => {
      const next = new Set(prev);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-panel-line bg-panel shadow-sm">
      <div className="min-w-[800px]">
        {/* ヘッダー: 時間軸 */}
        <div className="flex border-b border-gray-200">
          <div className="w-56 shrink-0 px-3 pb-4 pt-2 text-xs font-semibold text-[#4B5563]">配車</div>
          <div className="relative flex-1">
            {HOURS.map((h, i) => (
              <div
                key={h}
                className={`absolute top-0 border-l border-gray-100 px-1 pb-4 pt-2 text-xs text-[#4B5563] ${
                  i === HOURS.length - 1 ? 'border-l-0 border-r text-right' : ''
                }`}
                style={
                  i === HOURS.length - 1
                    ? { right: 0 }
                    : { left: `${pct((h - START_HOUR) * 60)}%` }
                }
              >
                {h}:00
              </div>
            ))}
            {/* 「12:00」など時刻ラベルと重ならないよう、行の下寄りに離して表示する */}
            {showLunchBand && (
              <div
                className="absolute bottom-0.5 flex items-center justify-center overflow-hidden whitespace-nowrap text-[10px] font-semibold text-[#4B5563]"
                style={{ left: `${pct(lunchStartMinutes)}%`, width: `${pct(lunchEndMinutes) - pct(lunchStartMinutes)}%` }}
              >
                昼休み
              </div>
            )}
          </div>
        </div>

        {/* ルート行 */}
        {routes.map(route => {
          // このルートの時刻計算の基準日（1便目の出発日）。日をまたぐ時刻をminutesFromStartで
          // 正しく扱うために、このルート内の全ての時刻計算で共通して使う
          const routeReferenceDate = resolveRouteReferenceDate(route);
          const validStopTimes = route.stops
            .filter(s => s.scheduledTime)
            .map(s => ({ ...s, minutes: minutesFromStart(s.scheduledTime as string, routeReferenceDate) }));
          const startMinutes = route.departureTime
            ? minutesFromStart(route.departureTime, routeReferenceDate)
            : validStopTimes[0]?.minutes;
          const lastStop = validStopTimes[validStopTimes.length - 1];
          // バーの終端＝最後の配送先の荷下ろし完了後、本社へ戻り終える予定時刻。
          // 荷下ろし後・本社への移動のいずれかが昼休みにかかる場合は休憩明けまで繰り下げる
          // （従来はこの帰還レッグにだけ昼休みが考慮されておらず、かかっていても遅延なしとして計算されていた）
          const routeLunchBreak = lastStop
            ? resolveLunchBreak(new Date(lastStop.scheduledTime as string), lunchBreakStart, lunchBreakEnd)
            : undefined;
          const estimatedReturnDate = lastStop
            ? estimateReturnToDepotTime(
                depotCenter,
                lastStop,
                new Date(lastStop.scheduledTime as string),
                routeLunchBreak,
                stopDurationMinutes,
                travel
              )
            : undefined;
          const estimatedEndMinutes = estimatedReturnDate ? minutesFromStart(estimatedReturnDate.toISOString(), routeReferenceDate) : undefined;
          // 帰社ボタンが押されていれば、推定より早い・遅いに関わらずその実績時刻をバー全体の終端とする
          // （実績が分かっている以上、古い推定に合わせて位置をずらす理由はない）。
          // status !== 'COMPLETED'のとき（データ不整合等でreturnedAtだけが残ってしまった場合）は
          // 実績扱いしない。正規の書き込み経路（driver/[routeId]・optimize/route.ts）は必ず
          // status: 'COMPLETED'とreturnedAtをセットで書き込むため、本来はズレないはずの防御的チェック
          const actualReturnedMinutes =
            route.returnedAt && route.routeStatus === 'COMPLETED' ? minutesFromStart(route.returnedAt, routeReferenceDate) : undefined;
          const endMinutes = actualReturnedMinutes ?? estimatedEndMinutes;
          // バーの緑色区間は「区間の直前の停車地」単位で判定する（stopOrder通りに進んだかは問わない）。
          // 以前は完了済み停車地のうち予定時刻が最も遅いものまでを一括で緑塗りしていたが、これだと
          // 順番を飛ばして先の配送先を先に済ませた場合、その手前にあるまだ未完了の停車地が緑の帯の
          // 内側に取り残されて見える（未完了なのに完了しているように見えてしまう）問題があった。
          // 区間ごとに「その区間の到着点（停車地）が完了済みか」で個別に緑/未完了を判定し、連続する
          // 緑区間だけをひとつのバーにまとめることで、順番通りに進んだ通常時は従来と同じ見た目のまま、
          // 順番を飛ばした場合は緑の帯が飛び飛びになり実態と矛盾しない表示になる
          const greenRanges: { from: number; to: number }[] = [];
          if (startMinutes !== undefined && endMinutes !== undefined && endMinutes >= startMinutes) {
            let prevMinutes = startMinutes;
            const pushRange = (from: number, to: number, green: boolean) => {
              if (to < from || !green) return;
              const last = greenRanges[greenRanges.length - 1];
              if (last && last.to === from) {
                last.to = to;
              } else {
                greenRanges.push({ from, to });
              }
            };
            for (const stop of validStopTimes) {
              pushRange(prevMinutes, stop.minutes, stop.status === 'COMPLETED');
              prevMinutes = stop.minutes;
            }
            // 最後の区間（最終配送先→本社）は、帰社実績（returnedAt）が確定している場合のみ緑にする
            pushRange(prevMinutes, endMinutes, actualReturnedMinutes !== undefined);
          }

          const { prefix, lastFour } = splitPlateNo(route.truckPlateNo);
          const completedCount = route.stops.filter(s => s.status === 'COMPLETED').length;
          const isCompleted = route.routeStatus === 'COMPLETED';
          const operationStatus = route.routeStatus
            ? computeRouteOperationStatus(route.routeStatus, route.stops.some(s => s.status === 'COMPLETED'))
            : undefined;
          const hasPackageData = route.stops.some(s => s.packages !== undefined);
          const isExpanded = expandedRouteIds.has(route.id);
          const hasReloadTrip = route.stops.some(s => s.addedAfterDeparture);
          // 複数便対応フェーズ4：便が2件以上ある場合だけ、下のバー・マーカー描画を便ごとに分ける
          // （1件以下は複数便扱いする意味がないため、既存の単一ルート描画のまま）
          const hasMultipleTrips = (route.trips?.length ?? 0) > 1;

          return (
            <Fragment key={route.id}>
            <div
              className={`flex border-b border-gray-100 last:border-b-0 ${
                isCompleted ? 'border-l-4 border-l-green-500 bg-green-50' : ''
              }`}
            >
              <div
                className={`flex w-56 shrink-0 items-center gap-2 px-3 py-3 ${
                  onRouteClick ? 'cursor-pointer hover:bg-green-100/60' : ''
                } ${!isCompleted && onRouteClick ? 'hover:bg-gray-50' : ''}`}
                onClick={onRouteClick ? () => onRouteClick(route) : undefined}
              >
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: route.color }} />
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-xs text-[#4B5563]">
                    {prefix}
                    {lastFour && <span className="ml-1 text-base font-semibold text-gray-800">{lastFour}</span>}
                  </div>
                  <div className="truncate text-xs font-semibold text-gray-700">{route.driverName}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    {operationStatus && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ROUTE_OPERATION_STATUS_STYLES[operationStatus]}`}
                      >
                        {ROUTE_OPERATION_STATUS_LABELS[operationStatus]}
                      </span>
                    )}
                    <span className="whitespace-nowrap text-xs font-semibold text-[#4B5563]">
                      {completedCount}/{route.stops.length}件
                    </span>
                    {hasReloadTrip && (
                      <span
                        className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                        title="稼働開始後に配送先が追加され、一旦本社に戻って積み込んでから再出発する前提で到着予定時刻を計算しています"
                      >
                        本社経由あり
                      </span>
                    )}
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      const url = `${window.location.origin}/driver/${route.id}`;
                      navigator.clipboard.writeText(url);
                      warnDialog(url, { title: 'コピーしました', variant: 'info' });
                    }}
                    aria-label="ドライバー用URLをコピー"
                    title="ドライバー用URLをコピー"
                    className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                    >
                      <path d="M10 13a5 5 0 0 0 7.07 0l1.93-1.93a5 5 0 0 0-7.07-7.07L10.5 5.5" />
                      <path d="M14 11a5 5 0 0 0-7.07 0L4.99 12.93a5 5 0 0 0 7.07 7.07L13.5 18.5" />
                    </svg>
                  </button>
                  {hasPackageData && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        toggleExpanded(route.id);
                      }}
                      aria-label={isExpanded ? '荷物一覧を閉じる' : '荷物一覧を開く'}
                      className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              <div className="relative flex-1 py-3" style={{ minHeight: '4.5rem' }}>
                {/* グリッド線 */}
                <div className="absolute inset-0">
                  {HOURS.map(h => (
                    <div
                      key={h}
                      className="absolute top-0 h-full border-l border-gray-100"
                      style={{ left: `${pct((h - START_HOUR) * 60)}%` }}
                    />
                  ))}
                  {/* 昼休み帯: 縞模様で「業務をしない時間帯」であることを明示する */}
                  {showLunchBand && (
                    <div
                      className="absolute top-0 h-full opacity-60"
                      style={{
                        left: `${pct(lunchStartMinutes)}%`,
                        width: `${pct(lunchEndMinutes) - pct(lunchStartMinutes)}%`,
                        backgroundImage:
                          'repeating-linear-gradient(45deg, rgb(229 231 235) 0, rgb(229 231 235) 4px, transparent 4px, transparent 8px)',
                      }}
                    />
                  )}
                </div>

                {/* バー: 完了済み区間は濃く、未完了区間は薄く表示。終端は最後の配送先から本社へ戻り終える予定時刻 */}
                {!hasMultipleTrips && startMinutes !== undefined && endMinutes !== undefined && endMinutes >= startMinutes && (
                  <>
                    <div
                      className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full opacity-30"
                      style={{
                        left: `${pct(startMinutes)}%`,
                        width: `${pct(endMinutes) - pct(startMinutes)}%`,
                        backgroundColor: route.color,
                      }}
                    />
                    {greenRanges.map((r, idx) => (
                      <div
                        key={idx}
                        className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full"
                        style={{
                          left: `${pct(r.from)}%`,
                          width: `${pct(r.to) - pct(r.from)}%`,
                          backgroundColor: '#16a34a',
                        }}
                      />
                    ))}
                  </>
                )}

                {/* 出発マーカー */}
                {!hasMultipleTrips && route.departureTime && (
                  <div
                    className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded"
                    style={{ left: `${pct(minutesFromStart(route.departureTime, routeReferenceDate))}%`, backgroundColor: route.color }}
                    title={`出発 ${format(new Date(route.departureTime), 'HH:mm')}`}
                  />
                )}

                {/* 帰社マーカー: 実績（returnedAt）があれば確定の帰着として緑塗りで強調し、
                    なければ推定（予定）として従来通り白丸＋トラック色の輪郭で表示する。
                    常時表示のラベルも「帰社予定」/「帰社」で明確に区別する */}
                {!hasMultipleTrips && lastStop && endMinutes !== undefined && (() => {
                  const endPct = pct(endMinutes);
                  // 停車地マーカーと同じ理由で、端に寄っている場合はラベル・ツールチップを左右いずれかに寄せる
                  const edgeAnchor = endPct > 85 ? 'right' : endPct < 8 ? 'left' : 'center';
                  const horizontalPositionClass =
                    edgeAnchor === 'right' ? 'right-0' : edgeAnchor === 'left' ? 'left-0' : 'left-1/2 -translate-x-1/2';
                  const isActual = actualReturnedMinutes !== undefined;
                  const returnTime = isActual
                    ? format(new Date(route.returnedAt as string), 'HH:mm')
                    : format(estimatedReturnDate as Date, 'HH:mm');
                  return (
                    <div
                      className={`group absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-default rounded-full border-2 border-white shadow ${
                        isActual ? 'bg-green-600' : 'bg-white'
                      }`}
                      style={{ left: `${endPct}%` }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={isActual ? '#ffffff' : route.color}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-full w-full p-0.5"
                      >
                        <path d="M3 11l9-7 9 7" />
                        <path d="M5 10v9a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1v-9" />
                      </svg>

                      <div
                        className={`pointer-events-none absolute top-4 whitespace-nowrap text-[10px] leading-none ${
                          isActual ? 'font-semibold text-green-700' : 'font-semibold text-[#4B5563]'
                        } ${horizontalPositionClass}`}
                      >
                        {isActual ? '帰社' : '帰社予定'}
                      </div>

                      <div
                        className={`pointer-events-none absolute -top-8 hidden whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white group-hover:block ${horizontalPositionClass}`}
                      >
                        {isActual ? '本社帰着' : '本社帰着予定'} {returnTime}
                      </div>
                    </div>
                  );
                })()}

                {/* 停車地マーカー */}
                {!hasMultipleTrips && validStopTimes.map((stop, i) => {
                  const shortLabel = stop.name.slice(0, 3);
                  const labelAbove = i % 2 === 1;
                  const stopPct = pct(stop.minutes);
                  // 端に寄っているマーカーは中央揃えのままだとラベル・ツールチップがチャート外へはみ出し、
                  // overflow-x-autoのスクロール幅がホバーのたびに変わってスクロールバーが暴れるため、端では左右いずれかに寄せる
                  const edgeAnchor = stopPct > 85 ? 'right' : stopPct < 8 ? 'left' : 'center';
                  const horizontalPositionClass =
                    edgeAnchor === 'right' ? 'right-0' : edgeAnchor === 'left' ? 'left-0' : 'left-1/2 -translate-x-1/2';
                  return (
                    <div
                      key={stop.id}
                      className="group absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-default rounded-full border-2 border-white"
                      style={{
                        left: `${stopPct}%`,
                        backgroundColor:
                          stop.status === 'COMPLETED' ? '#16a34a' : stop.isTimeFixed ? '#dc2626' : route.color,
                      }}
                    >
                      {/* 常時表示の短縮ラベル */}
                      <div
                        className={`pointer-events-none absolute whitespace-nowrap text-[10px] leading-none ${horizontalPositionClass} ${
                          stop.isTimeFixed ? 'font-semibold text-red-600' : 'text-[#4B5563]'
                        } ${labelAbove ? 'bottom-3' : 'top-3'}`}
                      >
                        {shortLabel}
                      </div>

                      {/* ホバー時の詳細ツールチップ */}
                      <div
                        className={`pointer-events-none absolute -top-8 hidden whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white group-hover:block ${horizontalPositionClass}`}
                      >
                        {stop.name}{' '}
                        {format(
                          new Date((stop.isTimeFixed && stop.requestedArrivalTime) || (stop.scheduledTime as string)),
                          'HH:mm'
                        )}
                        {stop.isTimeFixed && '（時刻指定）'}
                      </div>
                    </div>
                  );
                })}

                {!hasMultipleTrips && startMinutes === undefined && (
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[#4B5563]">
                    時刻未設定
                  </div>
                )}

                {/* 複数便対応フェーズ4：便が2件以上ある場合、上のバー・各種マーカーは便ごとに繰り返す。
                    見た目は既存の単一ルート用マーカー（出発・帰社/帰社予定・本社経由・停車地）と同じものを
                    便の数だけ描画する。最後の便だけ終端に「帰社/帰社予定」マーカー、それ以外は「本社経由」マーカー */}
                {hasMultipleTrips && route.trips!.map((trip, tripIdx) => {
                  const isLastTrip = tripIdx === route.trips!.length - 1;
                  const tripStopTimes = route.stops
                    .filter(s => s.tripId === trip.id && s.scheduledTime)
                    .map(s => ({ ...s, minutes: minutesFromStart(s.scheduledTime as string, routeReferenceDate) }))
                    .sort((a, b) => a.minutes - b.minutes);
                  const tripStart = trip.departureTime
                    ? minutesFromStart(trip.departureTime, routeReferenceDate)
                    : tripStopTimes[0]?.minutes;
                  const tripLastStop = tripStopTimes[tripStopTimes.length - 1];
                  const tripLunchBreak = tripLastStop
                    ? resolveLunchBreak(new Date(tripLastStop.scheduledTime as string), lunchBreakStart, lunchBreakEnd)
                    : undefined;
                  const tripEstimatedReturnDate = tripLastStop
                    ? estimateReturnToDepotTime(
                        depotCenter,
                        tripLastStop,
                        new Date(tripLastStop.scheduledTime as string),
                        tripLunchBreak,
                        stopDurationMinutes,
                        travel
                      )
                    : undefined;
                  const tripEstimatedEndMinutes = tripEstimatedReturnDate
                    ? minutesFromStart(tripEstimatedReturnDate.toISOString(), routeReferenceDate)
                    : undefined;
                  // 最後の便のtrip.returnedAtは「その便の最後の配送を終えた瞬間」に自動セットされる
                  // だけで、実際に本社へ帰着したことは意味しない（本社への移動時間が未考慮）。
                  // 本物の帰着実績は、帰社ボタンで確定するroute.returnedAtの方なので、最後の便だけは
                  // そちらを使う（そうしないと帰社前なのに「帰社」表示になり、最後の停車地マーカーより
                  // 手前に帰社マーカーが表示されて重なって見えるバグがあった）。
                  // 最後の便以外は従来通りtrip.returnedAt（本社経由＝reload実績）を使う。
                  // 単一ルート側と同じ理由で、status !== 'COMPLETED'なら実績扱いしない防御的チェック
                  const tripReturnedAt = isLastTrip ? route.returnedAt : trip.returnedAt;
                  const tripReturnedAtConfirmed = isLastTrip ? route.routeStatus === 'COMPLETED' : trip.status === 'COMPLETED';
                  const tripActualReturnedMinutes =
                    tripReturnedAt && tripReturnedAtConfirmed ? minutesFromStart(tripReturnedAt, routeReferenceDate) : undefined;
                  const tripEndMinutes = tripActualReturnedMinutes ?? tripEstimatedEndMinutes;

                  const tripGreenRanges: { from: number; to: number }[] = [];
                  if (tripStart !== undefined && tripEndMinutes !== undefined && tripEndMinutes >= tripStart) {
                    let prevMinutes = tripStart;
                    const pushRange = (from: number, to: number, green: boolean) => {
                      if (to < from || !green) return;
                      const last = tripGreenRanges[tripGreenRanges.length - 1];
                      if (last && last.to === from) last.to = to;
                      else tripGreenRanges.push({ from, to });
                    };
                    for (const stop of tripStopTimes) {
                      pushRange(prevMinutes, stop.minutes, stop.status === 'COMPLETED');
                      prevMinutes = stop.minutes;
                    }
                    pushRange(prevMinutes, tripEndMinutes, tripActualReturnedMinutes !== undefined);
                  }

                  return (
                    <Fragment key={trip.id}>
                      {tripStart !== undefined && tripEndMinutes !== undefined && tripEndMinutes >= tripStart && (
                        <>
                          <div
                            className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full opacity-30"
                            style={{
                              left: `${pct(tripStart)}%`,
                              width: `${pct(tripEndMinutes) - pct(tripStart)}%`,
                              backgroundColor: route.color,
                            }}
                          />
                          {tripGreenRanges.map((r, idx) => (
                            <div
                              key={idx}
                              className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full"
                              style={{
                                left: `${pct(r.from)}%`,
                                width: `${pct(r.to) - pct(r.from)}%`,
                                backgroundColor: '#16a34a',
                              }}
                            />
                          ))}
                        </>
                      )}

                      {trip.departureTime && (
                        <div
                          className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded"
                          style={{ left: `${pct(minutesFromStart(trip.departureTime, routeReferenceDate))}%`, backgroundColor: route.color }}
                          title={`${trip.tripIndex + 1}便 出発 ${format(new Date(trip.departureTime), 'HH:mm')}`}
                        />
                      )}

                      {tripLastStop && tripEndMinutes !== undefined && (() => {
                        const endPct = pct(tripEndMinutes);
                        const edgeAnchor = endPct > 85 ? 'right' : endPct < 8 ? 'left' : 'center';
                        const horizontalPositionClass =
                          edgeAnchor === 'right' ? 'right-0' : edgeAnchor === 'left' ? 'left-0' : 'left-1/2 -translate-x-1/2';
                        const isActual = tripActualReturnedMinutes !== undefined;
                        const returnTime = isActual
                          ? format(new Date(tripReturnedAt as string), 'HH:mm')
                          : format(tripEstimatedReturnDate as Date, 'HH:mm');

                        if (isLastTrip) {
                          // 最後の便：既存の「帰社/帰社予定」マーカーと同じ見た目
                          return (
                            <div
                              className={`group absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-default rounded-full border-2 border-white shadow ${
                                isActual ? 'bg-green-600' : 'bg-white'
                              }`}
                              style={{ left: `${endPct}%` }}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke={isActual ? '#ffffff' : route.color}
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-full w-full p-0.5"
                              >
                                <path d="M3 11l9-7 9 7" />
                                <path d="M5 10v9a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1v-9" />
                              </svg>
                              <div
                                className={`pointer-events-none absolute top-4 whitespace-nowrap text-[10px] leading-none ${
                                  isActual ? 'font-semibold text-green-700' : 'font-semibold text-[#4B5563]'
                                } ${horizontalPositionClass}`}
                              >
                                {isActual ? '帰社' : '帰社予定'}
                              </div>
                              <div
                                className={`pointer-events-none absolute -top-8 hidden whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white group-hover:block ${horizontalPositionClass}`}
                              >
                                {isActual ? '本社帰着' : '本社帰着予定'} {returnTime}
                              </div>
                            </div>
                          );
                        }
                        // 最後の便以外：「本社経由」マーカーと同じ見た目。
                        // 帰社/帰社予定マーカーと同じ理由で、この便がまだ完了していない（＝この位置は
                        // まだ起こっていない予定にすぎない）場合は塗りつぶさず白抜きにし、文言も「N便完了」
                        // ではなく「N便終了予定」にする（以前は実績・予定を問わず同じ塗り色・同じ「完了」表記になっており、
                        // 1便が終わって本社に戻った直後、まだ始まってもいない2便のマーカーまで「完了」して見える問題があった）
                        return (
                          <div
                            className={`group absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-default rounded-full border-2 border-white shadow ${
                              isActual ? 'bg-amber-500' : 'bg-white'
                            }`}
                            style={{ left: `${endPct}%` }}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke={isActual ? '#ffffff' : '#D97706'}
                              strokeWidth={isActual ? 3 : 2.5}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-full w-full p-0.5"
                            >
                              <path d="M3 11l9-7 9 7" />
                              <path d="M5 10v9a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1v-9" />
                            </svg>
                            <div
                              className={`pointer-events-none absolute top-3 whitespace-nowrap text-[10px] font-semibold leading-none text-amber-700 ${horizontalPositionClass}`}
                            >
                              {isActual ? '本社' : '本社予定'}
                            </div>
                            <div
                              className={`pointer-events-none absolute -top-8 hidden whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white group-hover:block ${horizontalPositionClass}`}
                            >
                              {isActual
                                ? `${trip.tripIndex + 1}便完了・本社帰着 ${returnTime}`
                                : `${trip.tripIndex + 1}便終了予定・本社経由予定 ${returnTime}`}
                            </div>
                          </div>
                        );
                      })()}

                      {tripStopTimes.map((stop, i) => {
                        const shortLabel = stop.name.slice(0, 3);
                        const labelAbove = i % 2 === 1;
                        const stopPct = pct(stop.minutes);
                        const edgeAnchor = stopPct > 85 ? 'right' : stopPct < 8 ? 'left' : 'center';
                        const horizontalPositionClass =
                          edgeAnchor === 'right' ? 'right-0' : edgeAnchor === 'left' ? 'left-0' : 'left-1/2 -translate-x-1/2';
                        return (
                          <div
                            key={stop.id}
                            className="group absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-default rounded-full border-2 border-white"
                            style={{
                              left: `${stopPct}%`,
                              backgroundColor:
                                stop.status === 'COMPLETED' ? '#16a34a' : stop.isTimeFixed ? '#dc2626' : route.color,
                            }}
                          >
                            <div
                              className={`pointer-events-none absolute whitespace-nowrap text-[10px] leading-none ${horizontalPositionClass} ${
                                stop.isTimeFixed ? 'font-semibold text-red-600' : 'text-[#4B5563]'
                              } ${labelAbove ? 'bottom-3' : 'top-3'}`}
                            >
                              {shortLabel}
                            </div>
                            <div
                              className={`pointer-events-none absolute -top-8 hidden whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white group-hover:block ${horizontalPositionClass}`}
                            >
                              {stop.name}{' '}
                              {format(
                                new Date((stop.isTimeFixed && stop.requestedArrivalTime) || (stop.scheduledTime as string)),
                                'HH:mm'
                              )}
                              {stop.isTimeFixed && '（時刻指定）'}
                            </div>
                          </div>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </div>
            </div>
            {hasPackageData && isExpanded && (
              <div className="border-b border-gray-100 bg-gray-50 py-3 pl-12 pr-3 last:border-b-0">
                <div className="space-y-2">
                  {route.stops.map(stop => (
                    <div key={stop.id}>
                      <p className="text-xs font-medium text-gray-700">
                        {stop.name}
                        {stop.scheduledTime && (
                          <span className="ml-1 font-normal text-gray-600">
                            {format(new Date(stop.scheduledTime), 'HH:mm')}頃
                          </span>
                        )}
                      </p>
                      {stop.packages && stop.packages.length > 0 ? (
                        <ul className="ml-2 mt-0.5 space-y-0.5 text-xs text-gray-500">
                          {groupPackages(stop.packages).map((g, i) => (
                            <li key={i}>
                              {g.name}（{g.width}×{g.depth}×{g.height}m）{g.count > 1 && ` × ${g.count}`}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="ml-2 mt-0.5 text-xs text-gray-600">荷物登録なし</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
