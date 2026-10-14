'use client';

import { useCallback, useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { FilePlus2, X } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import RelativeDayBadge from '@/components/plans/RelativeDayBadge';
import { isDefaultDayOff } from '@/lib/driverSchedule';
import type { RouteStatus } from '@prisma/client';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const DEFAULT_HORIZON_DAYS = 10;

type ApiRoute = { id: string; status: RouteStatus; truck: { plateNo: string }; driver: { name: string } };
type DayStatus = { count: number; hasUnassigned: boolean };
type ApiPoolStop = { id: string; locationId: string; routeId: string | null; location: { name: string } };

// トラック・ドライバーの登録は/truck-schedule画面で行う（案A、2026-08-03決定）。
// この画面は対象日を選び、既に登録済みのトラック構成を確認したうえで配送先・荷物の
// 割当画面（/plans/[id]）へ進むための入口に過ぎない。DBには何も書き込まない。
function NewPlanPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialDate = searchParams.get('date') || format(new Date(), 'yyyy-MM-dd');
  const today = format(new Date(), 'yyyy-MM-dd');

  const [date, setDate] = useState(initialDate);
  const [routes, setRoutes] = useState<ApiRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [poolStops, setPoolStops] = useState<ApiPoolStop[]>([]);
  const [poolLoading, setPoolLoading] = useState(true);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date(initialDate)));
  const [monthDays, setMonthDays] = useState<Record<string, DayStatus>>({});
  const [excludeWeekendsAndHolidays, setExcludeWeekendsAndHolidays] = useState(false);
  const [horizonDays, setHorizonDays] = useState(DEFAULT_HORIZON_DAYS);

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then((data: { excludeWeekendsAndHolidays?: boolean; truckScheduleHorizonDays?: number }) => {
        setExcludeWeekendsAndHolidays(!!data.excludeWeekendsAndHolidays);
        setHorizonDays(data.truckScheduleHorizonDays ?? DEFAULT_HORIZON_DAYS);
      });
  }, []);

  const fetchMonthDays = useCallback(async (month: Date) => {
    // カレンダーグリッドは月の前後にはみ出す前月末・翌月初の日にちも表示するため、
    // 表示範囲全体（calendarDaysと同じ計算）を渡す。月単位だけだと、はみ出した日にちの
    // 登録データが表示に反映されない（未登録扱いになる）ため
    const from = format(startOfWeek(startOfMonth(month)), 'yyyy-MM-dd');
    const to = format(endOfWeek(endOfMonth(month)), 'yyyy-MM-dd');
    const res = await fetch(`/api/plans/route-status-calendar?from=${from}&to=${to}`);
    const data = await res.json();
    setMonthDays(data.days ?? {});
  }, []);

  useEffect(() => {
    fetchMonthDays(calendarMonth);
  }, [calendarMonth, fetchMonthDays]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/plans?date=${date}`)
      .then(res => res.json())
      .then(setRoutes)
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(() => {
    setPoolLoading(true);
    fetch(`/api/pool?date=${date}`)
      .then(res => res.json())
      .then((data: { unassignedStops: ApiPoolStop[]; assignedStops: ApiPoolStop[] }) => {
        setPoolStops([...(data.unassignedStops ?? []), ...(data.assignedStops ?? [])]);
      })
      .finally(() => setPoolLoading(false));
  }, [date]);

  const handleCancel = useCallback(() => {
    router.push(`/plans?date=${date}`);
  }, [router, date]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        handleCancel();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleCancel]);

  function changeDate(value: string) {
    setDate(value);
    router.replace(`/plans/new?date=${value}`);
    const newMonth = startOfMonth(new Date(value));
    if (newMonth.getTime() !== calendarMonth.getTime()) {
      setCalendarMonth(newMonth);
    }
  }

  const maxDate = format(addDays(new Date(), horizonDays), 'yyyy-MM-dd');
  const calendarDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(calendarMonth)),
    end: endOfWeek(endOfMonth(calendarMonth)),
  });

  const locationsById = new Map<string, { locationId: string; name: string; hasUnassigned: boolean; hasAssigned: boolean }>();
  for (const s of poolStops) {
    const existing = locationsById.get(s.locationId);
    const isUnassigned = s.routeId === null;
    if (existing) {
      existing.hasUnassigned = existing.hasUnassigned || isUnassigned;
      existing.hasAssigned = existing.hasAssigned || !isUnassigned;
    } else {
      locationsById.set(s.locationId, {
        locationId: s.locationId,
        name: s.location.name,
        hasUnassigned: isUnassigned,
        hasAssigned: !isUnassigned,
      });
    }
  }
  const registeredLocations = Array.from(locationsById.values()).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const hasAnyAssignedLocation = registeredLocations.some(loc => loc.hasAssigned);
  const isPastDate = date < today;

  // 「配送先・荷物の割当へ進む」の遷移先。routes[0]（配列の先頭）を無条件に選ぶと、
  // それがたまたま稼働中のルートだった場合、意図せずそのトラック1台だけに固定された
  // 編集画面（稼働中ルートの編集）に飛ばされてしまう。稼働前のルートが1つでもあれば
  // それを優先する（その日全体の編集画面が開くのでどれを起点にしても同じ結果になる）。
  // 全ルートが稼働中の日は「その日全体を編集する画面」自体が存在しないため、
  // 一覧から編集したいトラックを選んでもらう。過去日（確認のみ・カレンダー上は選択不可で
  // URL直打ちでのみ到達しうる）はこの対象外とし、従来通りroutes[0]のまま変更しない
  const pendingRoute = !isPastDate ? routes.find(r => r.status === 'PENDING') : undefined;
  const allRoutesStarted = !isPastDate && routes.length > 0 && !pendingRoute;
  const unassignedLocationCount = registeredLocations.filter(loc => loc.hasUnassigned).length;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12 sm:pt-20">
      <div className="relative w-full max-w-[420px] rounded-xl bg-white shadow-xl">
        <button
          type="button"
          onClick={handleCancel}
          aria-label="キャンセル"
          className="absolute right-3 top-3 z-10 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="p-4 pb-0">
          <PageHeader icon={FilePlus2} title="配送計画の作成" description="配送日を選んでください。" tint="blueSoft" />
        </div>
        <div className="space-y-4 p-4">
          <div className="flex items-center gap-3">
            <p className="text-sm text-gray-600">
              対象日:{' '}
              <span className="text-[22px] font-semibold text-gray-800">
                {date.slice(5, 7)}/{date.slice(8, 10)}
              </span>
            </p>
            <RelativeDayBadge date={date} />
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
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
                <div key={w} className="py-1">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map(day => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const inCurrentMonth = isSameMonth(day, calendarMonth);
                const inRange = dayStr >= today && dayStr <= maxDate && !(excludeWeekendsAndHolidays && isDefaultDayOff(day));
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
                    disabled={!inRange}
                    onClick={() => changeDate(dayStr)}
                    className={[
                      'flex h-10 flex-col items-center justify-center rounded border text-xs transition-colors',
                      !inCurrentMonth && 'opacity-40',
                      !inRange && 'cursor-not-allowed bg-gray-200 text-gray-400',
                      inRange && isRegistered && hasUnassigned && 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100',
                      inRange && isRegistered && !hasUnassigned && 'border-blue-400 bg-blue-100 text-blue-900 hover:bg-blue-200',
                      inRange && !isRegistered && 'border-gray-400 bg-white text-gray-800 hover:bg-gray-50',
                      isSelected && 'relative z-10 border-red-500 ring-2 ring-red-500 ring-inset',
                      isToday && !isSelected && 'border-gray-400',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className={isToday ? 'font-bold' : ''}>{format(day, 'd')}</span>
                    {isRegistered ? (
                      <span
                        className={`mt-0.5 rounded-full px-1 py-0.5 text-[9px] font-semibold text-white ${
                          hasUnassigned ? 'bg-amber-500' : 'bg-blue-600'
                        }`}
                      >
                        {count}件
                      </span>
                    ) : inRange ? (
                      <span className="mt-0.5 text-[9px] text-gray-500">未登録</span>
                    ) : (
                      <span className="mt-0.5 text-[9px] text-gray-400">対象外</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {loading || poolLoading ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex animate-pulse items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="h-3 w-16 rounded bg-gray-200" />
                <div className="h-5 w-6 rounded bg-gray-200" />
              </div>
              <div className="flex animate-pulse items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="h-3 w-20 rounded bg-gray-200" />
                <div className="h-5 w-6 rounded bg-gray-200" />
              </div>
            </div>
          ) : routes.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p>この日にはまだトラックが登録されていません。先に稼働トラックの登録画面で登録してください。</p>
              <a
                href={`/truck-schedule?date=${date}`}
                className="mt-2 inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                稼働トラックの登録画面を開く
              </a>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <span className="text-xs text-gray-500">登録済みトラック</span>
                <span className="text-lg font-bold text-gray-800">{routes.length}</span>
              </div>
              <div
                className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border px-3 py-2 ${
                  unassignedLocationCount > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'
                }`}
              >
                <span className={`text-xs ${unassignedLocationCount > 0 ? 'text-amber-700' : 'text-gray-500'}`}>
                  登録済み配送先
                </span>
                <span className={`text-lg font-bold ${unassignedLocationCount > 0 ? 'text-amber-800' : 'text-gray-800'}`}>
                  {registeredLocations.length}
                </span>
                {unassignedLocationCount > 0 && (
                  <span className="whitespace-nowrap text-xs text-amber-700">（未割当 {unassignedLocationCount}）</span>
                )}
              </div>
            </div>
          )}

          {!loading && !poolLoading && routes.length > 0 && registeredLocations.length === 0 && (
            <p className="text-sm text-gray-600">
              まだ配送先が登録されていません。
              <a href={`/pool?date=${date}`} className="ml-1 font-medium text-blue-600 underline">
                荷物受付画面
              </a>
              から登録してください。
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              キャンセル
            </button>
            {!loading && routes.length > 0 && (
              <button
                onClick={() =>
                  router.push(
                    allRoutesStarted ? `/plans?date=${date}` : `/plans/${(pendingRoute ?? routes[0]).id}`
                  )
                }
                className="flex-1 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                {allRoutesStarted ? (
                  <>
                    全ルート稼働中のため、
                    <br />
                    配送計画一覧へ
                  </>
                ) : isPastDate
                    ? '配送先・荷物の割当へ進む（確認のみ）'
                    : hasAnyAssignedLocation
                      ? 'トラックに配送先・荷物を割当てる'
                      : '確定'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// useSearchParams を使う画面は、本番の組み立て（next build）で事前描画できるよう Suspense で囲む必要がある
export default function NewPlanPage() {
  return (
    <Suspense>
      <NewPlanPageContent />
    </Suspense>
  );
}
