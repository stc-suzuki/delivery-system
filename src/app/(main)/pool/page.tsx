'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  format,
  addDays,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
} from 'date-fns';
import { Package } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import RelativeDayBadge from '@/components/plans/RelativeDayBadge';
import { isDefaultDayOff } from '@/lib/driverSchedule';
import { checkCapacityOverflow } from '@/lib/loadCapacity';
import { arrivalConflictText } from '@/lib/timeBands';
import NewOrderPanel from '@/components/pool/NewOrderPanel';
import RegisteredOrdersPanel, { RegisteredStop } from '@/components/pool/RegisteredOrdersPanel';
import LocationOrdersPanel from '@/components/pool/LocationOrdersPanel';

// 荷物受付。「新規の受付」（電話で1件ずつ、空き日時を見て受け付ける。2026-11-16導入）と
// 「登録内容の確認・修正」（日付を選んで、その日の受付を1件1行で見る・直す。2026-11-17作り直し）のタブ。
// 今までの「日付を選んで配送先にチェックを入れ、まとめて保存する」入力は、新規の受付に置き換えた

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const DEFAULT_HORIZON_DAYS = 10;

type ApiStop = RegisteredStop & { status: string };
type TruckCapacitySummary = {
  totalM3: number;
  effectiveM3: number;
  loadUtilizationPercent: number;
  assumedTripsPerDay: number;
  truckCount: number;
  uncappedTruckCount: number;
};
type TimeOverflowSummary = {
  overCapacityTime: boolean;
  deliveryEndTime: string;
  latestFinishTime: string | null;
  arrivalConflicts: { stopId: string; locationName: string; requestedArrivalTime: string | null; windowLabel: string | null }[];
};
type Product = { id: string; name: string; width: number; depth: number; height: number };

function sumPackagesVolume(pkgs: { width: number; depth: number; height: number }[]): number {
  return pkgs.reduce((sum, p) => sum + p.width * p.depth * p.height, 0);
}

// 稼働トラックの登録画面（/truck-schedule）は一般ユーザー（STAFF）はアクセスできない
// （middleware.tsのROLE_RANK参照）。この画面から誘導リンクを出しても踏めないため、
// 権限がない場合はリンクを出さず問い合わせ案内のみ表示する
const ROLE_RANK: Record<string, number> = { STAFF: 0, DELIVERY_ADMIN: 1, SYSTEM_ADMIN: 2 };

function PoolPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const initialDate = searchParams.get('date') || format(new Date(), 'yyyy-MM-dd');

  const [tab, setTab] = useState<'new' | 'edit'>(searchParams.get('tab') === 'edit' || searchParams.get('date') ? 'edit' : 'new');
  const [date, setDate] = useState(initialDate);
  const [stops, setStops] = useState<ApiStop[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [truckCapacity, setTruckCapacity] = useState<TruckCapacitySummary | null>(null);
  const [timeOverflow, setTimeOverflow] = useState<TimeOverflowSummary | null>(null);
  const [registeredDates, setRegisteredDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date(initialDate)));
  const [monthCounts, setMonthCounts] = useState<Record<string, number>>({});
  const [excludeWeekendsAndHolidays, setExcludeWeekendsAndHolidays] = useState(false);
  const [horizonDays, setHorizonDays] = useState(DEFAULT_HORIZON_DAYS);
  // 確認・修正タブの見方：日付で見る（カレンダーで日を選ぶ）／配送先で探す（今日以降の受付を配送先から。2026-11-17導入）
  const [editMode, setEditMode] = useState<'date' | 'location'>('date');

  const switchTab = (next: 'new' | 'edit') => {
    if (next === tab) return;
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'edit') params.set('tab', 'edit');
    else {
      params.delete('tab');
      params.delete('date');
    }
    router.replace(`/pool${params.toString() ? `?${params}` : ''}`);
  };

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then((data: { excludeWeekendsAndHolidays?: boolean; truckScheduleHorizonDays?: number }) => {
        setExcludeWeekendsAndHolidays(!!data.excludeWeekendsAndHolidays);
        setHorizonDays(data.truckScheduleHorizonDays ?? DEFAULT_HORIZON_DAYS);
      });
    fetch('/api/products')
      .then(res => res.json())
      .then((data: Product[]) => setProducts(Array.isArray(data) ? data : []));
  }, []);

  const fetchMonthCounts = useCallback(async (month: Date) => {
    // カレンダーグリッドは月の前後にはみ出す前月末・翌月初の日にちも表示するため、
    // 表示範囲全体（calendarDaysと同じ計算）を渡す
    const from = format(startOfWeek(startOfMonth(month)), 'yyyy-MM-dd');
    const to = format(endOfWeek(endOfMonth(month)), 'yyyy-MM-dd');
    const res = await fetch(`/api/pool/calendar?from=${from}&to=${to}`);
    const data = await res.json();
    setMonthCounts(data.counts ?? {});
  }, []);

  useEffect(() => {
    fetchMonthCounts(calendarMonth);
  }, [calendarMonth, fetchMonthCounts]);

  // silent: 修正・取り消しの後の読み直しでは「読み込み中...」に差し替えない（一覧の表示を保つ）
  const fetchPool = useCallback(async (targetDate: string, options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    setError('');
    try {
      const [poolRes, datesRes] = await Promise.all([fetch(`/api/pool?date=${targetDate}`), fetch('/api/plans/dates')]);
      const poolData: {
        unassignedStops: ApiStop[];
        assignedStops: ApiStop[];
        truckCapacity: TruckCapacitySummary;
        timeOverflow: TimeOverflowSummary;
      } = await poolRes.json();
      if (!poolRes.ok) throw new Error((poolData as unknown as { error?: string }).error ?? '受付の取得に失敗しました');
      setStops([...poolData.unassignedStops, ...poolData.assignedStops]);
      setTruckCapacity(poolData.truckCapacity);
      setTimeOverflow(poolData.timeOverflow);
      const datesData: { dates: string[] } = await datesRes.json();
      setRegisteredDates(new Set(datesData.dates ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : '受付の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'edit') fetchPool(date);
  }, [date, tab, fetchPool]);

  function changeDate(value: string) {
    setDate(value);
    router.replace(`/pool?tab=edit&date=${value}`);
    const newMonth = startOfMonth(new Date(value));
    if (newMonth.getTime() !== calendarMonth.getTime()) {
      setCalendarMonth(newMonth);
    }
  }

  const today = format(new Date(), 'yyyy-MM-dd');
  const dateHasTrucks = registeredDates.has(date);
  const maxDate = format(addDays(new Date(), horizonDays), 'yyyy-MM-dd');
  const role = (session?.user as { role?: string } | undefined)?.role ?? 'STAFF';
  const canManageTrucks = (ROLE_RANK[role] ?? 0) >= 1;
  const calendarDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(calendarMonth)),
    end: endOfWeek(endOfMonth(calendarMonth)),
  });

  // その日の荷物の合計（配達完了分を除く）。判定には積載余裕率を差し引いた実効容量（effectiveM3）を使う
  const volumeM3 = sumPackagesVolume(stops.filter(s => s.status !== 'COMPLETED').flatMap(s => s.packages));
  const capacityBand =
    truckCapacity && truckCapacity.totalM3 > 0
      ? { ...truckCapacity, ...checkCapacityOverflow(truckCapacity.effectiveM3, [volumeM3]) }
      : null;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Package}
        title="荷物受付"
        description="電話で受けた配送先・荷物を、空いている日時を見ながら1件ずつ受け付けます。※ 配送計画は配送管理者が行います。"
        tint="blue"
      />
      <div className="flex border-b border-gray-200">
        {(
          [
            ['new', '新規の受付'],
            ['edit', '登録内容の確認・修正'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => switchTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              tab === key ? 'border-blue-600 font-semibold text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'new' ? (
        <NewOrderPanel
          onRegistered={() => fetchMonthCounts(calendarMonth)}
          onShowDay={d => {
            setTab('edit');
            setEditMode('date');
            changeDate(d);
          }}
        />
      ) : (
        <>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex overflow-hidden rounded border border-gray-300 text-sm">
            {(
              [
                ['date', '日付で見る'],
                ['location', '配送先で探す'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setEditMode(key)}
                className={`border-l border-gray-300 px-3 py-1 first:border-l-0 ${
                  editMode === key ? 'bg-blue-100 font-bold text-blue-900' : 'bg-white text-gray-600'
                }`}
              >
                {label}
              </button>
            ))}
          </span>
          {editMode === 'location' && <span className="text-xs text-gray-500">日付が分からない変更・取り消しの電話のときに使います</span>}
        </div>
        {editMode === 'location' ? (
          <LocationOrdersPanel
            products={products}
            canManageTrucks={canManageTrucks}
            onChanged={async () => {
              await Promise.all([fetchPool(date, { silent: true }), fetchMonthCounts(calendarMonth)]);
            }}
          />
        ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm lg:w-[340px] lg:shrink-0">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setCalendarMonth(subMonths(calendarMonth, 1))}
                className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
              >
                ← 前月
              </button>
              <span className="text-sm font-semibold text-gray-700">{format(calendarMonth, 'yyyy年M月')}</span>
              <button
                type="button"
                onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))}
                className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
              >
                次月 →
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-gray-500">
              {WEEKDAY_LABELS.map(w => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map(day => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const inCurrentMonth = isSameMonth(day, calendarMonth);
                const inRange = dayStr >= today && dayStr <= maxDate && !(excludeWeekendsAndHolidays && isDefaultDayOff(day));
                const locationCount = monthCounts[dayStr] ?? 0;
                const isRegistered = locationCount > 0;
                const isSelected = dayStr === date;
                const isToday = dayStr === today;

                return (
                  <button
                    type="button"
                    key={dayStr}
                    disabled={!inRange}
                    onClick={() => changeDate(dayStr)}
                    className={[
                      'flex h-11 flex-col items-center justify-center rounded border text-xs transition-colors',
                      !inCurrentMonth && 'opacity-40',
                      !inRange && 'cursor-not-allowed bg-gray-200 text-gray-400',
                      inRange && isRegistered && 'border-blue-400 bg-blue-100 text-blue-900 hover:bg-blue-200',
                      inRange && !isRegistered && 'border-gray-400 bg-white text-gray-800 hover:bg-gray-50',
                      isSelected && 'relative z-10 border-red-500 ring-2 ring-red-500 ring-inset',
                      isToday && !isSelected && 'border-gray-400',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className={isToday ? 'font-bold' : ''}>{format(day, 'd')}</span>
                    {isRegistered ? (
                      <span className="mt-0.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {locationCount}件
                      </span>
                    ) : inRange ? (
                      <span className="mt-0.5 text-[10px] text-gray-500">未登録</span>
                    ) : (
                      <span className="mt-0.5 text-[10px] text-gray-400">対象外</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex flex-col gap-1 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 shrink-0 rounded border border-blue-400 bg-blue-100" />
                受付あり（数字は件数）
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 shrink-0 rounded border border-gray-400 bg-white" />
                受付なし
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 shrink-0 rounded bg-gray-200" />
                受付期間外
              </span>
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-600">
                対象日:{' '}
                <span className="text-[22px] font-semibold text-gray-800">
                  {date.slice(5, 7)}/{date.slice(8, 10)}
                </span>
              </p>
              <RelativeDayBadge date={date} />
              <span className="text-sm text-gray-600">受付 {stops.length}件</span>
            </div>

            {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

            {loading ? (
              <p className="text-gray-500">読み込み中...</p>
            ) : (
              <>
                {!dateHasTrucks ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    {canManageTrucks ? (
                      <>
                        <p>この日（{date}）にはまだトラックが登録されていません。先に稼働トラックの登録画面で登録してください。</p>
                        <a
                          href={`/truck-schedule?date=${date}`}
                          className="mt-2 inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                        >
                          稼働トラックの登録画面を開く
                        </a>
                      </>
                    ) : (
                      <p>
                        この日（{date}）にはまだトラックが登録されていません。トラックの登録は「配送管理者」または「システム管理者」に問い合わせてください。
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="flex-1">
                      {truckCapacity && truckCapacity.totalM3 === 0 ? (
                        <div className="rounded-lg border border-panel-line bg-panel px-3 py-2 text-xs text-[#4B5563]">
                          容量未設定（登録済み {volumeM3.toFixed(2)}m3）
                        </div>
                      ) : capacityBand ? (
                        (() => {
                          const usageRatio = volumeM3 / capacityBand.effectiveM3;
                          const barTone = capacityBand.overCapacity ? 'bg-red-500' : usageRatio >= 0.8 ? 'bg-amber-500' : 'bg-brand';
                          return (
                            <div
                              className={`rounded-lg border px-3 py-2 text-xs ${
                                capacityBand.overCapacity ? 'border-red-300 bg-red-50 text-red-800' : 'border-panel-line bg-panel text-heading'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span>
                                  <span className="font-semibold">
                                    {capacityBand.overCapacity ? '⚠ 容積超過' : '容積'}：{volumeM3.toFixed(2)} / {capacityBand.effectiveM3.toFixed(2)}m3
                                  </span>
                                  <span className="font-normal text-[#4B5563]">　商品総量/トラック容量×{capacityBand.assumedTripsPerDay}往復</span>
                                </span>
                                <span className="shrink-0 text-[#4B5563]">{Math.round(usageRatio * 100)}%</span>
                              </div>
                              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-panel-line">
                                <div
                                  className={`h-full rounded-full transition-all ${barTone}`}
                                  style={{ width: `${Math.min(usageRatio, 1) * 100}%` }}
                                />
                              </div>
                            </div>
                          );
                        })()
                      ) : null}
                    </div>

                    {timeOverflow && (
                      <div
                        className={`flex-1 rounded-lg border px-3 py-2 text-xs ${
                          timeOverflow.overCapacityTime ? 'border-red-300 bg-red-50 text-red-800' : 'border-panel-line bg-panel text-heading'
                        }`}
                      >
                        <span className="font-semibold">
                          {timeOverflow.overCapacityTime
                            ? `⚠ 時間超過（定時${timeOverflow.deliveryEndTime}）`
                            : `時間：定時${timeOverflow.deliveryEndTime}に間に合う見込み`}
                        </span>
                        {timeOverflow.latestFinishTime && (
                          <span className="ml-2 text-[#4B5563]">本社帰着予定 {format(new Date(timeOverflow.latestFinishTime), 'HH:mm')}</span>
                        )}
                        {timeOverflow.arrivalConflicts.length > 0 && (
                          <div className="mt-1 font-semibold text-red-700">
                            ⚠ 時間指定・時間帯に間に合わない見込み：{timeOverflow.arrivalConflicts.map(arrivalConflictText).join('、')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <RegisteredOrdersPanel
                  date={date}
                  stops={stops}
                  products={products}
                  canManageTrucks={canManageTrucks}
                  onChanged={async () => {
                    await Promise.all([fetchPool(date, { silent: true }), fetchMonthCounts(calendarMonth)]);
                  }}
                />
              </>
            )}
          </div>
        </div>
        )}
        </>
      )}
    </div>
  );
}

// useSearchParams を使う画面は、本番の組み立て（next build）で事前描画できるよう Suspense で囲む必要がある
export default function PoolPage() {
  return (
    <Suspense>
      <PoolPageContent />
    </Suspense>
  );
}
