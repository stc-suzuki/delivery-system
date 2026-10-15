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
import PoolEditor, { PoolLocation, PoolProduct, PackageRow, groupPackagesByProduct } from '@/components/plans/PoolEditor';
import RelativeDayBadge from '@/components/plans/RelativeDayBadge';
import { isDefaultDayOff } from '@/lib/driverSchedule';
import { checkCapacityOverflow } from '@/lib/loadCapacity';
import { useDialog } from '@/components/ui/DialogProvider';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const DEFAULT_HORIZON_DAYS = 10;

type ApiPackage = { id: string; productId: string | null; name: string; width: number; depth: number; height: number };
type ApiStop = {
  id: string;
  locationId: string;
  scheduledTime: string | null;
  requestedArrivalTime: string | null;
  isTimeFixed: boolean;
  status: string;
  version: number;
  location: PoolLocation;
  packages: ApiPackage[];
};
type AssignedStop = ApiStop & {
  route: {
    id: string;
    departureTime: string | null;
    truck: { plateNo: string };
    driver: { name: string };
  } | null;
};
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
};

function sumPackagesVolume(pkgs: { width: number; depth: number; height: number }[]): number {
  return pkgs.reduce((sum, p) => sum + p.width * p.depth * p.height, 0);
}

// 保存時に「読み込み時点から実際に変わった行だけ」を判定するためのスナップショット。
// /api/pool のPUTを全置換方式から差分方式に変えたことに伴い導入（2026-08-20）。
type StopSnapshot = {
  stopId: string;
  version: number;
  arrivalTime: string;
  packagesCanonical: string;
};
type PackagePayload = { productId: string; name: string; width: number; depth: number; height: number };

function canonicalizePackages(pkgs: { productId: string | null; width: number; depth: number; height: number }[]): string {
  return pkgs
    .map(p => `${p.productId ?? ''}|${p.width}|${p.depth}|${p.height}`)
    .sort()
    .join(';');
}

// 稼働トラックの登録画面（/truck-schedule）は一般ユーザー（STAFF）はアクセスできない
// （middleware.tsのROLE_RANK参照）。この画面から誘導リンクを出しても踏めないため、
// 権限がない場合はリンクを出さず問い合わせ案内のみ表示する
const ROLE_RANK: Record<string, number> = { STAFF: 0, DELIVERY_ADMIN: 1, SYSTEM_ADMIN: 2 };

function PoolPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { confirmDialog, warnDialog } = useDialog();
  const initialDate = searchParams.get('date') || format(new Date(), 'yyyy-MM-dd');

  const [date, setDate] = useState(initialDate);
  const [locations, setLocations] = useState<PoolLocation[]>([]);
  const [products, setProducts] = useState<PoolProduct[]>([]);
  const [assignedStops, setAssignedStops] = useState<AssignedStop[]>([]);
  const [truckCapacity, setTruckCapacity] = useState<TruckCapacitySummary | null>(null);
  const [timeOverflow, setTimeOverflow] = useState<TimeOverflowSummary | null>(null);
  const [poolConflicts, setPoolConflicts] = useState<Map<string, string>>(new Map());
  const [registeredDates, setRegisteredDates] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [locSearch, setLocSearch] = useState('');
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set());
  const [arrivalTimes, setArrivalTimes] = useState<Record<string, string>>({});
  const [packages, setPackages] = useState<Record<string, PackageRow[]>>({});
  const [initialStops, setInitialStops] = useState<Map<string, StopSnapshot>>(new Map());
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date(initialDate)));
  const [monthCounts, setMonthCounts] = useState<Record<string, number>>({});
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

  const fetchMonthCounts = useCallback(async (month: Date) => {
    // カレンダーグリッドは月の前後にはみ出す前月末・翌月初の日にちも表示するため、
    // 表示範囲全体（calendarDaysと同じ計算）を渡す。月単位だけだと、はみ出した日にちの
    // 登録データが表示に反映されない（未登録扱いになる）ため
    const from = format(startOfWeek(startOfMonth(month)), 'yyyy-MM-dd');
    const to = format(endOfWeek(endOfMonth(month)), 'yyyy-MM-dd');
    const res = await fetch(`/api/pool/calendar?from=${from}&to=${to}`);
    const data = await res.json();
    setMonthCounts(data.counts ?? {});
  }, []);

  useEffect(() => {
    fetchMonthCounts(calendarMonth);
  }, [calendarMonth, fetchMonthCounts]);

  // silent: 保存直後の再取得など、既に画面に一覧が表示されている状態からの更新用。
  // ここでloadingを立てて画面全体を「読み込み中...」に差し替えてしまうと、
  // PoolEditor内の配送先一覧（独自のスクロール領域を持つ）が丸ごとアンマウント・
  // 再マウントされ、スクロール位置が先頭に戻って見える（初回表示・日付切替時のみloadingを使う）
  const fetchPool = useCallback(async (targetDate: string, options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    setError('');
    try {
      const [poolRes, locRes, productRes, datesRes] = await Promise.all([
        fetch(`/api/pool?date=${targetDate}`),
        fetch('/api/locations'),
        fetch('/api/products'),
        fetch('/api/plans/dates'),
      ]);
      const poolData: {
        unassignedStops: ApiStop[];
        assignedStops: AssignedStop[];
        truckCapacity: TruckCapacitySummary;
        timeOverflow: TimeOverflowSummary;
      } = await poolRes.json();
      if (!poolRes.ok) throw new Error((poolData as unknown as { error?: string }).error ?? 'プールの取得に失敗しました');
      setLocations(await locRes.json());
      setProducts(await productRes.json());
      setAssignedStops(poolData.assignedStops);
      setTruckCapacity(poolData.truckCapacity);
      setTimeOverflow(poolData.timeOverflow);
      const datesData: { dates: string[] } = await datesRes.json();
      setRegisteredDates(new Set(datesData.dates ?? []));

      const ids = new Set<string>();
      const times: Record<string, string> = {};
      const pkgs: Record<string, PackageRow[]> = {};
      const unassignedCountByLocation = new Map<string, number>();
      poolData.unassignedStops.forEach(s => {
        ids.add(s.locationId);
        unassignedCountByLocation.set(s.locationId, (unassignedCountByLocation.get(s.locationId) ?? 0) + 1);
        if (s.isTimeFixed && s.requestedArrivalTime) times[s.locationId] = format(new Date(s.requestedArrivalTime), 'HH:mm');
        pkgs[s.locationId] = groupPackagesByProduct(s.packages);
      });
      setSelectedLocationIds(ids);
      setArrivalTimes(times);
      setPackages(pkgs);

      // /api/pool のPUT側スキップ判定（割当済み／分割済みは新規作成・更新しない）と同じ条件を
      // 事前に検出し、保存前にバッジで気づけるようにする
      const conflicts = new Map<string, string>();
      unassignedCountByLocation.forEach((count, locationId) => {
        if (count > 1) conflicts.set(locationId, `分割済み（未割当${count}件・この画面では編集不可）`);
      });
      poolData.assignedStops.forEach(s => {
        if (!unassignedCountByLocation.has(s.locationId)) {
          conflicts.set(s.locationId, '割当済み（この画面では登録できません）');
        }
      });
      setPoolConflicts(conflicts);

      // 保存時の差分計算用スナップショット。競合（分割済み・割当済み）の配送先は
      // この画面から編集できないため対象外にする
      const snapshots = new Map<string, StopSnapshot>();
      poolData.unassignedStops.forEach(s => {
        if (conflicts.has(s.locationId)) return;
        snapshots.set(s.locationId, {
          stopId: s.id,
          version: s.version,
          arrivalTime: s.isTimeFixed && s.requestedArrivalTime ? format(new Date(s.requestedArrivalTime), 'HH:mm') : '',
          packagesCanonical: canonicalizePackages(s.packages),
        });
      });
      setInitialStops(snapshots);
      setDirty(false);

      // サーバー側の確定値（保存直後の容積超過チェック用）。/pool画面では常時表示のバンド側で
      // 未保存の編集内容も含めた見込み値を別途ライブ計算するため、ここではあくまで
      // 「実際にDBへ保存された内容」だけを見る
      const savedVolumeM3 =
        sumPackagesVolume(poolData.unassignedStops.flatMap(s => s.packages)) +
        sumPackagesVolume(poolData.assignedStops.filter(s => s.status !== 'COMPLETED').flatMap(s => s.packages));
      // 容量との比較には余裕率（デッドスペース対策）を差し引いた実効容量を使う
      const capacityM3 = poolData.truckCapacity.totalM3 > 0 ? poolData.truckCapacity.effectiveM3 : null;
      return {
        capacityM3,
        loadUtilizationPercent: poolData.truckCapacity.loadUtilizationPercent,
        assumedTripsPerDay: poolData.truckCapacity.assumedTripsPerDay,
        ...checkCapacityOverflow(capacityM3, [savedVolumeM3]),
        timeOverflow: poolData.timeOverflow,
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'プールの取得に失敗しました');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPool(date);
  }, [date, fetchPool]);

  // 保存前に画面を離れようとした場合の離脱ガード。タブを閉じる／リロードはブラウザ標準の
  // beforeunload警告に任せ、サイドバー等のアプリ内リンク遷移はクリックをcaptureフェーズで
  // 横取りして確認ダイアログを出す（Next.jsのLinkクリックより先に割り込む必要があるため）
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    }
    function handleLinkClick(e: MouseEvent) {
      if (!dirty || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement)?.closest('a');
      if (!anchor || anchor.target === '_blank') return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      // カスタムダイアログは非同期のため、クリックの既定動作は先に止めておき、
      // 確認が取れた場合のみこちらでナビゲーションする
      e.preventDefault();
      e.stopPropagation();
      confirmDialog('保存されていない変更があります。このまま移動すると内容が失われます。移動しますか？').then(ok => {
        if (ok) router.push(href);
      });
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleLinkClick, true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleLinkClick, true);
    };
  }, [dirty]);

  async function changeDate(value: string) {
    if (dirty && !(await confirmDialog('保存されていない変更があります。日付を変更すると内容が失われます。移動しますか？'))) {
      return;
    }
    setDate(value);
    setSaved(false);
    setDirty(false);
    router.replace(`/pool?date=${value}`);
    const newMonth = startOfMonth(new Date(value));
    if (newMonth.getTime() !== calendarMonth.getTime()) {
      setCalendarMonth(newMonth);
    }
  }

  function toggleLocation(id: string) {
    setSelectedLocationIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setArrivalTimes(prevTimes => {
          const nextTimes = { ...prevTimes };
          delete nextTimes[id];
          return nextTimes;
        });
        setPackages(prevPkgs => {
          const nextPkgs = { ...prevPkgs };
          delete nextPkgs[id];
          return nextPkgs;
        });
      } else {
        next.add(id);
      }
      return next;
    });
    setSaved(false);
    setDirty(true);
  }

  function updateArrivalTime(id: string, time: string) {
    setArrivalTimes(prev => {
      const next = { ...prev };
      if (time) next[id] = time;
      else delete next[id];
      return next;
    });
    setSaved(false);
    setDirty(true);
  }

  function addPackage(locationId: string) {
    setPackages(prev => ({
      ...prev,
      [locationId]: [
        ...(prev[locationId] ?? []),
        { key: crypto.randomUUID(), productId: '', name: '', width: '', depth: '', height: '', quantity: '1' },
      ],
    }));
    setSaved(false);
    setDirty(true);
  }

  function removePackage(locationId: string, key: string) {
    setPackages(prev => ({
      ...prev,
      [locationId]: (prev[locationId] ?? []).filter(p => p.key !== key),
    }));
    setSaved(false);
    setDirty(true);
  }

  function updatePackageProduct(locationId: string, key: string, productId: string) {
    const product = products.find(pr => pr.id === productId);
    setPackages(prev => ({
      ...prev,
      [locationId]: (prev[locationId] ?? []).map(p =>
        p.key === key
          ? {
              ...p,
              productId,
              name: product?.name ?? '',
              width: product ? String(product.width) : '',
              depth: product ? String(product.depth) : '',
              height: product ? String(product.height) : '',
            }
          : p
      ),
    }));
    setSaved(false);
    setDirty(true);
  }

  function updatePackageQuantity(locationId: string, key: string, quantity: string) {
    setPackages(prev => ({
      ...prev,
      [locationId]: (prev[locationId] ?? []).map(p => (p.key === key ? { ...p, quantity } : p)),
    }));
    setSaved(false);
    setDirty(true);
  }

  function packageVolumeFor(locationId: string): number {
    return (packages[locationId] ?? []).reduce((sum, p) => {
      const w = Number(p.width) || 0;
      const d = Number(p.depth) || 0;
      const h = Number(p.height) || 0;
      const qty = Math.max(1, Number(p.quantity) || 1);
      return sum + w * d * h * qty;
    }, 0);
  }

  function timeToIso(time: string): string | null {
    if (!time) return null;
    return new Date(`${date}T${time}:00`).toISOString();
  }

  function packagesPayloadFor(locationId: string): PackagePayload[] {
    return (packages[locationId] ?? [])
      .filter(p => p.productId)
      .flatMap(p =>
        Array.from({ length: Math.max(1, Number(p.quantity) || 1) }, () => ({
          productId: p.productId,
          name: p.name,
          width: Number(p.width),
          depth: Number(p.depth),
          height: Number(p.height),
        }))
      );
  }

  async function handleSave() {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      // 読み込み時点のスナップショット（initialStops）と現在の入力内容を比較し、
      // 実際に触った行だけをadd/update/removeとして送る（他人が触った行には触れない）
      const currentIds = Array.from(selectedLocationIds).filter(id => !poolConflicts.has(id));
      const currentIdSet = new Set(currentIds);

      const add: { locationId: string; arrivalTime: string | null; packages: PackagePayload[] }[] = [];
      const update: { stopId: string; version: number; arrivalTime: string | null; packages: PackagePayload[] }[] = [];
      const remove: { stopId: string; version: number }[] = [];

      initialStops.forEach((snap, locationId) => {
        if (!currentIdSet.has(locationId)) {
          remove.push({ stopId: snap.stopId, version: snap.version });
        }
      });

      for (const locationId of currentIds) {
        const snap = initialStops.get(locationId);
        const arrivalTime = arrivalTimes[locationId] ?? '';
        const pkgs = packagesPayloadFor(locationId);
        const arrivalIso = timeToIso(arrivalTime);

        if (!snap) {
          add.push({ locationId, arrivalTime: arrivalIso, packages: pkgs });
          continue;
        }
        const changed =
          snap.arrivalTime !== arrivalTime || snap.packagesCanonical !== canonicalizePackages(pkgs);
        if (changed) {
          update.push({ stopId: snap.stopId, version: snap.version, arrivalTime: arrivalIso, packages: pkgs });
        }
      }

      if (add.length === 0 && update.length === 0 && remove.length === 0) {
        setSaved(true);
        setDirty(false);
        return;
      }

      const res = await fetch('/api/pool', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, add, update, remove }),
      });
      const data: { notSaved?: { locationName: string; reason: string }[]; error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.notSaved && data.notSaved.length > 0) {
        await warnDialog(
          data.notSaved.map(s => `${s.locationName}: ${s.reason}`),
          { title: '以下の配送先は保存されませんでした' }
        );
      }
      setSaved(true);
      const capacityResult = await fetchPool(date, { silent: true });
      await fetchMonthCounts(calendarMonth);
      window.dispatchEvent(new Event('pool:updated'));
      const overflowWarnings: string[] = [];
      if (capacityResult?.overCapacity) {
        const marginNote =
          capacityResult.loadUtilizationPercent < 100 ? `、積載利用率${capacityResult.loadUtilizationPercent}%で判定` : '';
        overflowWarnings.push(
          `登録済み荷物の合計体積がトラックの実効容量を超えています（合計${capacityResult.totalVolume.toFixed(2)}m3 / 実効容量${(capacityResult.capacityM3 ?? 0).toFixed(2)}m3、1日${capacityResult.assumedTripsPerDay}往復想定${marginNote}）`
        );
      }
      if (capacityResult?.timeOverflow.overCapacityTime) {
        const finishLabel = capacityResult.timeOverflow.latestFinishTime
          ? format(new Date(capacityResult.timeOverflow.latestFinishTime), 'HH:mm')
          : '不明';
        overflowWarnings.push(
          `定時（${capacityResult.timeOverflow.deliveryEndTime}）までに本社へ戻れない可能性があります（最も遅いトラックの本社帰着予定 ${finishLabel}）`
        );
      }
      if (overflowWarnings.length > 0) {
        await warnDialog(overflowWarnings, {
          title: 'この日の登録内容について、以下の点にご注意ください',
          footer: 'トラックを追加するか、他の日への振り分けをご検討ください。',
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setBusy(false);
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

  // 常時表示のサマリー帯用：保存前の画面上の入力内容も含めたライブの合計体積。
  // 割当済み分（サーバー取得済み、この画面では編集不可）は完了済みを除いて加算する
  const liveVolumeM3 =
    Array.from(selectedLocationIds).reduce((sum, id) => sum + packageVolumeFor(id), 0) +
    sumPackagesVolume(assignedStops.filter(s => s.status !== 'COMPLETED').flatMap(s => s.packages));
  // truckCapacityと超過判定結果を1つにまとめておく（JSX側でtruckCapacityのnull断定を避けるため）。
  // 判定には積載余裕率（デッドスペース対策）を差し引いた実効容量（effectiveM3）を使う
  const capacityBand =
    truckCapacity && truckCapacity.totalM3 > 0
      ? { ...truckCapacity, ...checkCapacityOverflow(truckCapacity.effectiveM3, [liveVolumeM3]) }
      : null;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Package}
        title="荷物受付"
        description="その日「どこ」に「何」を届けるかだけを登録できます。　※ 配送計画は配送管理者が行います。計画作成後は「配送計画一覧」で確認できます。"
        tint="blue"
      />
      {date === today && (
        <p className="text-sm text-gray-500">配送当日（トラックが出発する前）も追加・変更が可能です。</p>
      )}

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
            <div key={w} className="py-1">{w}</div>
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
            配送先・荷物を登録済み（数字は配送先の件数）
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 shrink-0 rounded border border-gray-400 bg-white" />
            配送先・荷物をまだ登録していない
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 shrink-0 rounded bg-gray-200" />
            登録期間外
          </span>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-sm text-gray-600">
          対象日:{' '}
          <span className="text-[22px] font-semibold text-gray-800">
            {date.slice(5, 7)}/{date.slice(8, 10)}
          </span>
        </p>
        <RelativeDayBadge date={date} />
      </div>

      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
      {saved && <p className="rounded bg-green-50 p-2 text-sm text-green-700">保存しました。</p>}

      {loading ? (
        <p className="text-gray-500">読み込み中...</p>
      ) : !dateHasTrucks ? (
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
            <p>この日（{date}）にはまだトラックが登録されていません。トラックの登録は「配送管理者」または「システム管理者」に問い合わせてください。</p>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-1">
          <h2 className="text-sm text-heading">積載量・到着時間の概略シミュレーション</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              {truckCapacity && truckCapacity.totalM3 === 0 ? (
                <div className="rounded-lg border border-panel-line bg-panel px-3 py-2 text-xs text-[#4B5563]">
                  容量未設定（登録済み {liveVolumeM3.toFixed(2)}m3）
                </div>
              ) : capacityBand ? (
                (() => {
                  const usageRatio = liveVolumeM3 / capacityBand.effectiveM3;
                  const barTone = capacityBand.overCapacity ? 'bg-red-500' : usageRatio >= 0.8 ? 'bg-amber-500' : 'bg-brand';
                  return (
                    <div
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        capacityBand.overCapacity
                          ? 'border-red-300 bg-red-50 text-red-800'
                          : 'border-panel-line bg-panel text-heading'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          <span className="font-semibold">
                            {capacityBand.overCapacity ? '⚠ 容積超過' : '容積'}：{liveVolumeM3.toFixed(2)} / {capacityBand.effectiveM3.toFixed(2)}m3
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
                  {timeOverflow.overCapacityTime ? `⚠ 時間超過（定時${timeOverflow.deliveryEndTime}）` : `時間：定時${timeOverflow.deliveryEndTime}に間に合う見込み`}
                </span>
                {timeOverflow.latestFinishTime && (
                  <span className="ml-2 text-[#4B5563]">
                    本社帰着予定 {format(new Date(timeOverflow.latestFinishTime), 'HH:mm')}
                  </span>
                )}
              </div>
            )}
          </div>
          </div>

          <div
            className={`rounded-lg border p-3 shadow-sm ${
              selectedLocationIds.size > 0 ? 'border-amber-300 bg-amber-50' : 'border-panel-line bg-panel'
            }`}
          >
            <div className="mb-2 flex items-center gap-2">
              <h2
                className={`text-sm font-semibold ${
                  selectedLocationIds.size > 0 ? 'text-amber-900' : 'text-heading'
                }`}
              >
                未割当（登録・編集可能）
              </h2>
              <span
                className={
                  selectedLocationIds.size > 0
                    ? 'rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900'
                    : 'text-xs text-[#4B5563]'
                }
              >
                選択済み: {selectedLocationIds.size}件
              </span>
            </div>
            <PoolEditor
              locations={locations}
              products={products}
              locSearch={locSearch}
              onSearchChange={setLocSearch}
              selectedLocationIds={selectedLocationIds}
              arrivalTimes={arrivalTimes}
              packages={packages}
              poolConflictInfo={poolConflicts}
              editable
              confirmOnDeselect
              listMaxHeightClassName="max-h-[28rem]"
              onToggleLocation={toggleLocation}
              onUpdateArrivalTime={updateArrivalTime}
              onAddPackage={addPackage}
              onRemovePackage={removePackage}
              onUpdatePackageProduct={updatePackageProduct}
              onUpdatePackageQuantity={updatePackageQuantity}
              packageVolumeFor={packageVolumeFor}
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={busy || !dirty}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? '保存中...' : '保存'}
              </button>
              {dirty && !busy && <span className="text-xs text-amber-600">保存されていないデータがあります</span>}
            </div>
          </div>

          {assignedStops.length > 0 && (
            <div className="rounded-lg border border-panel-line bg-panel p-3 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-heading">割当済み（この画面では編集できません）</h2>
              <ul className="space-y-1 text-sm text-gray-600">
                {assignedStops.map(s => (
                  <li key={s.id} className="flex items-center gap-2">
                    <span className="truncate">{s.location.name}</span>
                    {s.route && (
                      <span className="shrink-0 rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700">
                        {s.route.truck.plateNo} / {s.route.driver.name}
                      </span>
                    )}
                    {s.route && canManageTrucks && (
                      <a href={`/plans/${s.route.id}`} className="shrink-0 text-xs text-blue-600 hover:underline">
                        ルートを見る
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      </div>
      </div>
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
