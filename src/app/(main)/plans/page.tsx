'use client';

import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
} from 'date-fns';
import { ClipboardList, Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import RefreshButton from '@/components/ui/RefreshButton';
import DispatchGanttChart, { GanttRoute, splitPlateNo } from '@/components/plans/DispatchGanttChart';
import RelativeDayBadge from '@/components/plans/RelativeDayBadge';
import { RouteStatus } from '@prisma/client';
import { computeRouteOperationStatus, RouteOperationStatus } from '@/lib/routeOperationStatus';
import { travelModelFromSettings, type TravelModel } from '@/lib/routeOptimizer';

// ルート同士の見分けは行の分離・トラック番号表示で十分なため、識別色はローテーションさせず単一色に統一する
// （赤は到着希望時刻ありの停車地マーカーの警告色として予約しているため使わない）
const ROUTE_COLOR = '#2563eb';

// 配送計画の作成・編集画面（/plans/[id]）は一般ユーザー（STAFF）はアクセスできない
// （middleware.tsのROLE_RANK参照。踏むとダッシュボードへ強制的にリダイレクトされる）。
// この画面から編集導線を出しても踏めないため、権限がない場合は行クリックでの遷移・
// 案内文言のどちらも出さず、参照専用（ガントチャートを眺めるだけ）にする
const ROLE_RANK: Record<string, number> = { STAFF: 0, DELIVERY_ADMIN: 1, SYSTEM_ADMIN: 2 };

type RouteStop = {
  id: string;
  scheduledTime: string | null;
  requestedArrivalTime: string | null;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
  isTimeFixed: boolean;
  addedAfterDeparture: boolean;
  // このルートの中でどの便（RouteTrip）の荷物か。null＝便を使わない今まで通りの単一ルート扱い
  tripId: string | null;
  location: { name: string; lat: number; lng: number };
  packages: { id: string; name: string; width: number; depth: number; height: number }[];
};
// 複数便対応フェーズ4：ガントチャートに渡す便情報
type ApiTrip = {
  id: string;
  tripIndex: number;
  status: RouteStatus;
  departureTime: string | null;
  returnedAt: string | null;
};
type ApiRoute = {
  id: string;
  routeDate: string;
  status: RouteStatus;
  truck: { plateNo: string };
  driver: { name: string };
  departureTime: string | null;
  returnedAt: string | null;
  stops: RouteStop[];
  trips: ApiTrip[];
};

type SortKey = 'departure' | 'status' | 'truck' | 'driver' | 'stopCount' | 'attention';
// 日付ごとの登録状況（配送先件数・未割当の有無）。ポップオーバーカレンダーの色分けに使う
type DayStatus = { count: number; hasUnassigned: boolean };
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

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

function getOperationStatus(route: GanttRoute): RouteOperationStatus {
  return route.routeStatus
    ? computeRouteOperationStatus(route.routeStatus, route.stops.some(s => s.status === 'COMPLETED'))
    : 'BEFORE_START';
}

function getAttentionScore(route: GanttRoute, now: Date): number {
  const departure = route.departureTime ? new Date(route.departureTime) : null;
  let score = 0;
  if (getOperationStatus(route) === 'BEFORE_START' && departure && departure < now) score += 2;
  // 遅延判定はお客様に約束した到着希望時刻（requestedArrivalTime）と比較する。見込み時刻（scheduledTime）は
  // 移動時間の都合でずれることがあり、遅延の有無を正しく表さないため使わない
  score += route.stops.filter(
    s => s.isTimeFixed && s.status === 'PENDING' && s.requestedArrivalTime && new Date(s.requestedArrivalTime) < now
  ).length;
  return score;
}

function sortRoutes(routes: GanttRoute[], sortKey: SortKey): GanttRoute[] {
  const now = new Date();
  return [...routes].sort((a, b) => {
    switch (sortKey) {
      case 'status':
        return OPERATION_RANK[getOperationStatus(a)] - OPERATION_RANK[getOperationStatus(b)];
      case 'truck':
        return splitPlateNo(a.truckPlateNo).lastFour.localeCompare(splitPlateNo(b.truckPlateNo).lastFour);
      case 'driver':
        return driverNameCollator.compare(a.driverName, b.driverName);
      case 'stopCount':
        return b.stops.length - a.stops.length;
      case 'attention':
        return getAttentionScore(b, now) - getAttentionScore(a, now);
      case 'departure':
      default: {
        const at = a.departureTime ? new Date(a.departureTime).getTime() : Infinity;
        const bt = b.departureTime ? new Date(b.departureTime).getTime() : Infinity;
        return at - bt;
      }
    }
  });
}

function todayStr() {
  // toISOString()はUTC基準になり、日本時間の深夜0時〜朝9時台は日付が1日ずれるため使わない
  return format(new Date(), 'yyyy-MM-dd');
}

function PlansPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? 'STAFF';
  const canEditRoutes = (ROLE_RANK[role] ?? 0) >= 1;
  const [date, setDate] = useState(() => searchParams.get('date') ?? format(new Date(), 'yyyy-MM-dd'));
  const [routes, setRoutes] = useState<ApiRoute[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('departure');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date(date)));
  const [monthDays, setMonthDays] = useState<Record<string, DayStatus>>({});
  const calendarRef = useRef<HTMLDivElement>(null);
  const [stopDurationMinutes, setStopDurationMinutes] = useState<number | undefined>(undefined);
  const [lunchBreakStart, setLunchBreakStart] = useState<string | undefined>(undefined);
  const [lunchBreakEnd, setLunchBreakEnd] = useState<string | undefined>(undefined);
  const [depotCenter, setDepotCenter] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [travel, setTravel] = useState<TravelModel | undefined>(undefined);

  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  // 日付を切り替えた直後に、前の日付の応答が遅れて届いても反映しないため
  const latestDateRef = useRef(date);

  // 荷物一覧の開閉やスクロール位置を崩さないよう、自動では読み直さず「更新」ボタンでだけ読み直す
  async function fetchRoutes() {
    const target = date;
    try {
      const res = await fetch(`/api/plans?date=${target}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      if (latestDateRef.current !== target) return;
      setRoutes(json);
      setUpdatedAt(new Date());
      setRefreshFailed(false);
    } catch {
      if (latestDateRef.current === target) setRefreshFailed(true);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([fetchRoutes(), fetchMonthDays(calendarMonth)]);
    setRefreshing(false);
  }

  useEffect(() => {
    latestDateRef.current = date;
    fetchRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // カレンダーグリッドは月の前後にはみ出す前月末・翌月初の日にちも表示するため、
  // 表示範囲全体（calendarDaysと同じ計算）を渡す（/plans/newの同名処理と同じ理由）。
  // 前月・次月を素早く切り替えると古い月のレスポンスが新しい月のレスポンスより後に
  // 返ってくる場合があるため、常に「最後にリクエストした月」のレスポンスだけを反映する
  const latestMonthKeyRef = useRef('');
  const fetchMonthDays = useCallback(async (month: Date) => {
    const monthKey = format(month, 'yyyy-MM');
    latestMonthKeyRef.current = monthKey;
    const from = format(startOfWeek(startOfMonth(month)), 'yyyy-MM-dd');
    const to = format(endOfWeek(endOfMonth(month)), 'yyyy-MM-dd');
    const res = await fetch(`/api/plans/route-status-calendar?from=${from}&to=${to}`);
    const data = await res.json();
    if (latestMonthKeyRef.current === monthKey) {
      setMonthDays(data.days ?? {});
    }
  }, []);

  useEffect(() => {
    fetchMonthDays(calendarMonth);
  }, [calendarMonth, fetchMonthDays]);

  // ポップオーバーを開くたびに、選択中の日付が属する月を表示する（前回開いていた月に
  // 取り残されないようにする。ネイティブの日付ピッカーが常に選択日の月を出すのと同じ挙動）
  function openCalendar() {
    setCalendarMonth(startOfMonth(new Date(date)));
    setCalendarOpen(true);
  }

  function selectDay(dayStr: string) {
    setDate(dayStr);
    setCalendarOpen(false);
  }

  useEffect(() => {
    if (!calendarOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setCalendarOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setCalendarOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [calendarOpen]);

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(
        (s: {
          defaultStopDurationMinutes: number;
          lunchBreakStart: string;
          lunchBreakEnd: string;
          depotLat: number;
          depotLng: number;
          averageSpeedKmh: number;
          roadDetourFactor: number;
          perLegTravelMinutes: number;
        }) => {
          setStopDurationMinutes(s.defaultStopDurationMinutes);
          setLunchBreakStart(s.lunchBreakStart);
          setLunchBreakEnd(s.lunchBreakEnd);
          setDepotCenter({ lat: s.depotLat, lng: s.depotLng });
          setTravel(travelModelFromSettings(s));
        }
      )
      .catch(() => {});
  }, []);

  const ganttRoutes: GanttRoute[] = routes.map(r => ({
    id: r.id,
    routeStatus: r.status,
    truckPlateNo: r.truck.plateNo,
    driverName: r.driver.name,
    color: ROUTE_COLOR,
    departureTime: r.departureTime,
    returnedAt: r.returnedAt,
    stops: r.stops.map(s => ({
      id: s.id,
      name: s.location.name,
      lat: s.location.lat,
      lng: s.location.lng,
      scheduledTime: s.scheduledTime,
      requestedArrivalTime: s.requestedArrivalTime,
      status: s.status,
      isTimeFixed: s.isTimeFixed,
      addedAfterDeparture: s.addedAfterDeparture,
      tripId: s.tripId,
      packages: s.packages,
    })),
    trips: r.trips,
  }));

  const sortedRoutes = sortRoutes(ganttRoutes, sortKey);
  const today = todayStr();
  const calendarDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(calendarMonth)),
    end: endOfWeek(endOfMonth(calendarMonth)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardList}
        title="配送計画一覧"
        description="各日のトラックの配送状況をまとめて確認できます。"
        tint="blue"
        showDeliveryAdminBadge={canEditRoutes}
      />

      <div className="flex items-center gap-3">
        <div ref={calendarRef} className="relative">
          <button
            type="button"
            onClick={() => (calendarOpen ? setCalendarOpen(false) : openCalendar())}
            className="flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 hover:bg-gray-50"
          >
            <CalendarIcon className="h-4 w-4 text-gray-500" />
            {date.replaceAll('-', '/')}
            {calendarOpen ? (
              <ChevronUp className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            )}
          </button>

          {calendarOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setCalendarMonth(subMonths(calendarMonth, 1))}
                  className="rounded p-1 text-gray-500 hover:bg-gray-100"
                  aria-label="前月"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold text-gray-700">{format(calendarMonth, 'yyyy年M月')}</span>
                <button
                  type="button"
                  onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))}
                  className="rounded p-1 text-gray-500 hover:bg-gray-100"
                  aria-label="次月"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-gray-500">
                {WEEKDAY_LABELS.map(w => (
                  <div key={w} className="py-0.5">{w}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {calendarDays.map(day => {
                  const dayStr = format(day, 'yyyy-MM-dd');
                  const inCurrentMonth = isSameMonth(day, calendarMonth);
                  const status = monthDays[dayStr];
                  const count = status?.count ?? 0;
                  const isRegistered = count > 0;
                  const hasUnassigned = status?.hasUnassigned ?? false;
                  const isSelected = dayStr === date;
                  const isToday = dayStr === today;

                  return (
                    <button
                      type="button"
                      key={dayStr}
                      onClick={() => selectDay(dayStr)}
                      title={isRegistered ? `配送先${count}件${hasUnassigned ? '（未割当あり）' : ''}` : '未登録'}
                      className={[
                        'flex h-8 flex-col items-center justify-center rounded border text-[11px] transition-colors',
                        !inCurrentMonth && 'opacity-40',
                        isRegistered && hasUnassigned && 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100',
                        isRegistered && !hasUnassigned && 'border-blue-400 bg-blue-100 text-blue-900 hover:bg-blue-200',
                        !isRegistered && 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                        isSelected && 'relative z-10 border-red-500 ring-2 ring-red-500 ring-inset',
                        isToday && !isSelected && 'border-gray-400',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <span className={isToday ? 'font-bold' : ''}>{format(day, 'd')}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-gray-100 pt-2 text-[10px] text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-blue-400" />
                  割当済み
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-amber-400" />
                  未割当あり
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm border border-gray-300" />
                  未登録
                </span>
              </div>
            </div>
          )}
        </div>
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value as SortKey)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
        <RefreshButton
          onRefresh={handleRefresh}
          refreshing={refreshing}
          updatedAt={updatedAt}
          failed={refreshFailed}
        />
      </div>

      <div>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
          配送計画 <span className="text-[22px]">{date.slice(5, 7)}/{date.slice(8, 10)}</span>
          <RelativeDayBadge date={date} />
          {date !== today && (
            <button
              type="button"
              onClick={() => setDate(today)}
              className="text-sm font-normal text-blue-600 hover:underline"
            >
              今日に戻す
            </button>
          )}
        </h2>
        {routes.length > 0 && canEditRoutes && (
          <p className="mb-2 text-sm text-gray-500">
            各行をクリックすると、そのトラックの配送ルートを編集できます。
          </p>
        )}
        {routes.length === 0 ? (
          <p className="text-sm text-gray-500">この日付のルートはありません</p>
        ) : (
          <DispatchGanttChart
            routes={sortedRoutes}
            onRouteClick={canEditRoutes ? route => router.push(`/plans/${route.id}`) : undefined}
            stopDurationMinutes={stopDurationMinutes}
            lunchBreakStart={lunchBreakStart}
            lunchBreakEnd={lunchBreakEnd}
            depotCenter={depotCenter}
            travel={travel}
          />
        )}
      </div>
    </div>
  );
}

// useSearchParams を使う画面は、本番の組み立て（next build）で事前描画できるよう Suspense で囲む必要がある
export default function PlansPage() {
  return (
    <Suspense>
      <PlansPageContent />
    </Suspense>
  );
}
