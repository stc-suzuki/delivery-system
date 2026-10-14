'use client';

import { useCallback, useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Truck as TruckIcon } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useDialog } from '@/components/ui/DialogProvider';
import {
  format,
  addDays,
  subDays,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
} from 'date-fns';
import { DRIVER_TYPE_LABELS, isDefaultDayOff } from '@/lib/driverSchedule';
import type { DriverType, RouteStatus } from '@prisma/client';
import RelativeDayBadge from '@/components/plans/RelativeDayBadge';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

type Truck = { id: string; plateNo: string; status: string; defaultDriverId: string | null };
type Driver = { id: string; name: string; type: DriverType };
type ApiRoute = {
  id: string;
  truckId: string;
  driverId: string;
  status: RouteStatus;
  departureTime: string | null;
  truck: { plateNo: string };
  driver: { name: string };
};

const DEFAULT_HORIZON_DAYS = 10;

// その日に使うトラック・ドライバーの組み合わせ（まだ稼働していないPENDINGルート）を登録・変更する画面。
// /plans/new・/plans/[id] にあったトラック選択処理をここへ切り出したもの。保存は既存の
// /api/plans/batch をそのまま利用する（PENDINGルートだけを対象に追加・更新・削除する。
// 稼働中・完了済みルートは変更されず、使用中のトラック・ドライバーとして空き判定にのみ反映される）
function TruckSchedulePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialDate = searchParams.get('date') || format(new Date(), 'yyyy-MM-dd');
  const today = format(new Date(), 'yyyy-MM-dd');
  const { confirmDialog } = useDialog();

  const [date, setDate] = useState(initialDate);
  const [horizonDays, setHorizonDays] = useState(DEFAULT_HORIZON_DAYS);
  const [excludeWeekendsAndHolidays, setExcludeWeekendsAndHolidays] = useState(false);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [startedRoutes, setStartedRoutes] = useState<ApiRoute[]>([]);
  const [selectedTruckIds, setSelectedTruckIds] = useState<Set<string>>(new Set());
  const [driverByTruckId, setDriverByTruckId] = useState<Record<string, string>>({});
  const [departureTime, setDepartureTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date(initialDate)));
  const [monthCounts, setMonthCounts] = useState<Record<string, number>>({});
  const [savedTruckIds, setSavedTruckIds] = useState<Set<string>>(new Set());
  const [savedDriverByTruckId, setSavedDriverByTruckId] = useState<Record<string, string>>({});
  const [savedDepartureTime, setSavedDepartureTime] = useState('');
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyInfo, setCopyInfo] = useState('');

  const maxDate = format(addDays(new Date(), horizonDays), 'yyyy-MM-dd');

  const fetchMonthCounts = useCallback(async (month: Date) => {
    // カレンダーグリッドは月の前後にはみ出す前月末・翌月初の日にちも表示するため、
    // 表示範囲全体（calendarDaysと同じ計算）を渡す。月単位だけだと、はみ出した日にちの
    // 登録データが表示に反映されない（未登録扱いになる）ため
    const from = format(startOfWeek(startOfMonth(month)), 'yyyy-MM-dd');
    const to = format(endOfWeek(endOfMonth(month)), 'yyyy-MM-dd');
    const res = await fetch(`/api/plans/calendar?from=${from}&to=${to}`);
    const data = await res.json();
    setMonthCounts(data.counts ?? {});
  }, []);

  useEffect(() => {
    fetchMonthCounts(calendarMonth);
  }, [calendarMonth, fetchMonthCounts]);

  const fetchAll = useCallback(async (targetDate: string) => {
    const [truckRes, driverRes, settingsRes, dayRes] = await Promise.all([
      fetch('/api/trucks'),
      fetch('/api/drivers?status=ACTIVE'),
      fetch('/api/settings'),
      fetch(`/api/plans?date=${targetDate}`),
    ]);
    setTrucks(await truckRes.json());
    setDrivers(await driverRes.json());
    const settingsData = await settingsRes.json();
    setHorizonDays(settingsData.truckScheduleHorizonDays ?? DEFAULT_HORIZON_DAYS);
    setExcludeWeekendsAndHolidays(!!settingsData.excludeWeekendsAndHolidays);
    const dayRoutes: ApiRoute[] = await dayRes.json();
    const started = dayRoutes.filter(r => r.status !== 'PENDING');
    const editable = dayRoutes.filter(r => r.status === 'PENDING');
    setStartedRoutes(started);
    setSelectedTruckIds(new Set(editable.map(r => r.truckId)));
    setSavedTruckIds(new Set(editable.map(r => r.truckId)));
    const editableDriverByTruckId = Object.fromEntries(editable.map(r => [r.truckId, r.driverId]));
    setDriverByTruckId(editableDriverByTruckId);
    setSavedDriverByTruckId(editableDriverByTruckId);
    const editableDeparture = editable.find(r => r.departureTime)?.departureTime;
    const resolvedDepartureTime = editableDeparture ? format(new Date(editableDeparture), 'HH:mm') : settingsData.defaultDepartureTime;
    setDepartureTime(resolvedDepartureTime);
    setSavedDepartureTime(resolvedDepartureTime);
  }, []);

  useEffect(() => {
    fetchAll(date);
  }, [date, fetchAll]);

  function changeDate(value: string) {
    setDate(value);
    setSaved(false);
    setCopyInfo('');
    setError('');
    router.replace(`/truck-schedule?date=${value}`);
    const newMonth = startOfMonth(new Date(value));
    if (newMonth.getTime() !== calendarMonth.getTime()) {
      setCalendarMonth(newMonth);
    }
  }

  // 土日・祝日を飛ばして直前の営業日の日付を求める（登録の有無は問わない）
  function previousBusinessDay(targetDate: string): string {
    let d = subDays(new Date(targetDate), 1);
    while (isDefaultDayOff(d)) {
      d = subDays(d, 1);
    }
    return format(d, 'yyyy-MM-dd');
  }

  // 前営業日に登録されていたトラック・ドライバーの組み合わせを選択状態にだけ反映する
  // （このボタンでは保存は行わない。登録するかどうかは「登録する」ボタンでユーザーが判断する）
  async function handleCopyPreviousBusinessDay() {
    setError('');
    setCopyInfo('');
    setCopyLoading(true);
    try {
      const prevDate = previousBusinessDay(date);
      const res = await fetch(`/api/plans?date=${prevDate}`);
      const prevRoutes: ApiRoute[] = await res.json();
      if (prevRoutes.length === 0) {
        setError(`前営業日（${prevDate}）にはトラックの登録がありません`);
        return;
      }
      const truckIdSet = new Set(trucks.map(t => t.id));
      const driverIdSet = new Set(drivers.map(d => d.id));
      const usable = prevRoutes.filter(r => truckIdSet.has(r.truckId) && driverIdSet.has(r.driverId));
      const copyable = usable.filter(r => !busyTruckIds.has(r.truckId) && !busyDriverIds.has(r.driverId));
      const skippedCount = usable.length - copyable.length;
      if (copyable.length === 0) {
        setError(`前営業日（${prevDate}）のトラック・ドライバーは、対象日ではすべて稼働中・完了済みルートで使用中のため選択できませんでした`);
        return;
      }
      setSelectedTruckIds(new Set(copyable.map(r => r.truckId)));
      setDriverByTruckId(Object.fromEntries(copyable.map(r => [r.truckId, r.driverId])));
      setSaved(false);
      setCopyInfo(
        `前営業日（${prevDate}）と同じ構成を選択しました（${copyable.length}台）。内容を確認のうえ「登録する」を押してください。` +
          (skippedCount > 0 ? ` ※${skippedCount}台は対象日で既に使用中のため除外しました。` : '')
      );
    } catch {
      setError('前営業日の構成の取得に失敗しました');
    } finally {
      setCopyLoading(false);
    }
  }

  async function toggleTruckSelection(truckId: string) {
    const isAdding = !selectedTruckIds.has(truckId);
    if (!isAdding && savedTruckIds.has(truckId)) {
      const truck = trucks.find(t => t.id === truckId);
      const ok = await confirmDialog(
        `${truck?.plateNo ?? 'このトラック'}は登録済みです。チェックを外すと保存時にこのトラックの割当が解除されます。よろしいですか？`
      );
      if (!ok) return;
    }
    setSelectedTruckIds(prev => {
      const next = new Set(prev);
      if (next.has(truckId)) next.delete(truckId);
      else next.add(truckId);
      return next;
    });
    if (isAdding) {
      setDriverByTruckId(prev => {
        if (prev[truckId]) return prev;
        const defaultDriverId = trucks.find(t => t.id === truckId)?.defaultDriverId;
        if (!defaultDriverId) return prev;
        const usedByOtherTruck = Object.entries(prev).some(
          ([otherTruckId, driverId]) => otherTruckId !== truckId && driverId === defaultDriverId
        );
        const busyDriverIds = new Set(startedRoutes.map(r => r.driverId));
        if (usedByOtherTruck || busyDriverIds.has(defaultDriverId)) return prev;
        return { ...prev, [truckId]: defaultDriverId };
      });
    }
    setSaved(false);
    setCopyInfo('');
  }

  function updateDriverForTruck(truckId: string, driverId: string) {
    setDriverByTruckId(prev => ({ ...prev, [truckId]: driverId }));
    setSaved(false);
    setCopyInfo('');
  }

  async function handleSave() {
    setBusy(true);
    setError('');
    setSaved(false);
    setCopyInfo('');
    try {
      const chosenTrucks = Array.from(selectedTruckIds).map(truckId => ({ truckId, driverId: driverByTruckId[truckId] ?? '' }));
      if (chosenTrucks.length === 0 && savedTruckIds.size === 0) {
        throw new Error('使用するトラックを1台以上選択してください');
      }
      if (chosenTrucks.length > 0 && excludeWeekendsAndHolidays && isDefaultDayOff(new Date(date))) {
        throw new Error('この日は土日祝日のため配送除外日です。トラックは登録できません。');
      }
      if (chosenTrucks.some(t => !t.driverId)) {
        throw new Error('選択した全てのトラックにドライバーを設定してください');
      }
      const driverIds = chosenTrucks.map(t => t.driverId);
      if (new Set(driverIds).size !== driverIds.length) {
        throw new Error('同じドライバーが複数のトラックに設定されています');
      }
      const res = await fetch('/api/plans/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, trucks: chosenTrucks, departureTime: departureTime || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchAll(date);
      await fetchMonthCounts(calendarMonth);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'トラック構成の保存に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  const busyTruckIds = new Set(startedRoutes.map(r => r.truckId));
  const busyDriverIds = new Set(startedRoutes.map(r => r.driverId));
  const truckSelectionChanged =
    selectedTruckIds.size !== savedTruckIds.size || Array.from(selectedTruckIds).some(id => !savedTruckIds.has(id));
  const driverAssignmentChanged = Array.from(selectedTruckIds).some(
    id => (driverByTruckId[id] ?? '') !== (savedDriverByTruckId[id] ?? '')
  );
  const departureTimeChanged = departureTime !== savedDepartureTime;
  const hasChanges = truckSelectionChanged || driverAssignmentChanged || departureTimeChanged;
  const isExcludedDay = excludeWeekendsAndHolidays && isDefaultDayOff(new Date(date));
  const calendarDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(calendarMonth)),
    end: endOfWeek(endOfMonth(calendarMonth)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={TruckIcon}
        title="稼働トラックの登録"
        description="対象日に使用するトラック・ドライバーの組み合わせを登録します。　※「トラックの登録」➡「荷物受付」➡「配送計画の作成」の順に、配送計画を作っていきます。"
        tint="blueSoft"
      />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="lg:w-[340px] lg:shrink-0">
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
            const truckCount = monthCounts[dayStr] ?? 0;
            const isRegistered = truckCount > 0;
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
                    {truckCount}台
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

        <div className="mt-3 flex flex-col gap-1 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 shrink-0 rounded border border-blue-400 bg-blue-100" />
            トラック・ドライバーを登録済み（数字は台数）
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 shrink-0 rounded border border-gray-400 bg-white" />
            トラック・ドライバーをまだ登録していない
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 shrink-0 rounded bg-gray-200" />
            登録期間外
          </span>
        </div>

      </div>

      <p className="mt-3 text-xs text-gray-600">
        Note：トラックを登録できる曜日や日にちはシステム設定で管理されています。詳しくはシステム管理者に確認ください。
      </p>
      </div>

      <div className="min-w-0 flex-1 space-y-4">
      <div className="flex items-end gap-4">
        <p className="text-sm text-gray-600">
          対象日:{' '}
          <span className="text-[22px] font-semibold text-gray-800">
            {date.slice(5, 7)}/{date.slice(8, 10)}
          </span>
        </p>
        <RelativeDayBadge date={date} />
        <div>
          <label className="block text-sm font-medium text-gray-700">出発時間</label>
          <input
            type="time"
            value={departureTime}
            onChange={e => {
              setDepartureTime(e.target.value);
              setSaved(false);
            }}
            className="mt-1 rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
      {!error && copyInfo && <p className="rounded bg-blue-50 p-2 text-sm text-blue-700">{copyInfo}</p>}
      {saved && !error && <p className="rounded bg-green-50 p-2 text-sm text-green-700">保存しました。</p>}

      {startedRoutes.length > 0 && (
        <div className="rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] p-3 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">稼働中・完了済みのトラック</h2>
          <ul className="space-y-1 text-sm text-gray-700">
            {startedRoutes.map(r => (
              <li key={r.id}>{r.truck.plateNo}（{r.driver.name}）</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[#4B5563]">運行中のため、この画面から変更できません。</p>
        </div>
      )}

      {isExcludedDay ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          この日（{date}）は土日祝日のため配送除外日です。トラックは登録できません。
        </div>
      ) : (
      <div className="rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">使用可能なトラックを選ぶ</h2>
          <button
            type="button"
            onClick={handleCopyPreviousBusinessDay}
            disabled={copyLoading}
            className="rounded bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {copyLoading ? '取得中...' : '前営業日と同じ構成を選択'}
          </button>
        </div>
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {trucks.filter(t => t.status !== 'RETIRED').map(t => {
            const checked = selectedTruckIds.has(t.id);
            const busyElsewhere = !checked && busyTruckIds.has(t.id);
            const usedByOtherTruck = new Set(
              Object.entries(driverByTruckId)
                .filter(([truckId, driverId]) => truckId !== t.id && selectedTruckIds.has(truckId) && driverId)
                .map(([, driverId]) => driverId)
            );
            return (
              <div key={t.id} className="flex items-center gap-2 text-sm">
                <label className="flex flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busyElsewhere}
                    title={busyElsewhere ? '同日の他の配送ルートで既に使用されています' : undefined}
                    onChange={() => toggleTruckSelection(t.id)}
                  />
                  <span>{t.plateNo}</span>
                  {busyElsewhere && (
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                      他の配送ルートで使用中
                    </span>
                  )}
                </label>
                {checked && (
                  <select
                    value={driverByTruckId[t.id] ?? ''}
                    onChange={e => updateDriverForTruck(t.id, e.target.value)}
                    className="rounded border border-gray-300 px-2 py-1 text-xs"
                  >
                    <option value="">ドライバーを選択</option>
                    {drivers.map(d => {
                      const unavailable = d.id !== driverByTruckId[t.id] && (usedByOtherTruck.has(d.id) || busyDriverIds.has(d.id));
                      return (
                        <option key={d.id} value={d.id} disabled={unavailable}>
                          {d.name}（{DRIVER_TYPE_LABELS[d.type]}）{unavailable ? '・使用中' : ''}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>
            );
          })}
        </div>
        <button
          onClick={handleSave}
          disabled={busy || !hasChanges}
          title={!busy && !hasChanges ? 'トラック・ドライバー・出発時間に変更がありません' : undefined}
          className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? '保存中...' : '登録する'}
        </button>
      </div>
      )}
      </div>
      </div>
    </div>
  );
}

// useSearchParams を使う画面は、本番の組み立て（next build）で事前描画できるよう Suspense で囲む必要がある
export default function TruckSchedulePage() {
  return (
    <Suspense>
      <TruckSchedulePageContent />
    </Suspense>
  );
}
