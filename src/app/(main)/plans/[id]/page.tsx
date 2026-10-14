'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { format, addDays } from 'date-fns';
import { ArrowUpDown, ClipboardCheck } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import RelativeDayBadge from '@/components/plans/RelativeDayBadge';
import { splitPlateNo } from '@/components/plans/DispatchGanttChart';
import { PackageRow, groupPackagesByProduct } from '@/components/plans/PoolEditor';
import { getEditWarning } from '@/lib/planEditPolicy';
import {
  computeRouteOperationStatus,
  ROUTE_OPERATION_STATUS_LABELS,
  ROUTE_OPERATION_STATUS_STYLES,
} from '@/lib/routeOperationStatus';
import { WARNING_USAGE_RATIO } from '@/lib/capacityOverviewStatus';
import { DRIVER_TYPE_LABELS } from '@/lib/driverSchedule';
import { useDialog } from '@/components/ui/DialogProvider';
import type { DriverType, RouteStatus } from '@prisma/client';

// 「配送先の割当」の一覧表示用。同一商品（商品名・寸法が一致するもの）をまとめ、
// 個数を数字で付けて表示する（1個ずつ並べると同じ行が何行も並んでしまうため）
function groupPackagesForDisplay(
  packages: { name: string; width: number; depth: number; height: number }[]
): { name: string; width: number; depth: number; height: number; count: number }[] {
  const grouped = new Map<string, { name: string; width: number; depth: number; height: number; count: number }>();
  packages.forEach(p => {
    const key = `${p.name}|${p.width}|${p.depth}|${p.height}`;
    const existing = grouped.get(key);
    if (existing) existing.count += 1;
    else grouped.set(key, { name: p.name, width: p.width, depth: p.depth, height: p.height, count: 1 });
  });
  return Array.from(grouped.values());
}

// 停車地1件分の荷物合計体積（m3）。手動割当時のヒント表示用
function stopVolume(packages: { width: number; depth: number; height: number }[]): number {
  return packages.reduce((sum, p) => sum + p.width * p.depth * p.height, 0);
}

// トラック1台（ルート1件）の現在の積載体積（m3）。「使用中のトラック」「割当済み」の
// 見出しに表示する積載率のヒント用。容積上限（capacityM3）が未設定のトラックは判定対象外。
// 便（トラックの往復）ごとに積み荷は独立しているため、全便の合計ではなく「最も積載量が多い便」の
// 体積を返す（合計だと、便を分ければ1台で運べる荷物量でも見かけ上オーバーしてしまうため）
function routeLoad(route: { stops: { tripId: string | null; packages: { width: number; depth: number; height: number }[] }[] }): number {
  const volumeByTripId = new Map<string, number>();
  for (const s of route.stops) {
    const key = s.tripId ?? '';
    volumeByTripId.set(key, (volumeByTripId.get(key) ?? 0) + stopVolume(s.packages));
  }
  return volumeByTripId.size > 0 ? Math.max(...Array.from(volumeByTripId.values())) : 0;
}

function loadBarColor(ratio: number): string {
  if (ratio > 1) return 'bg-red-600';
  if (ratio >= WARNING_USAGE_RATIO) return 'bg-amber-500';
  return 'bg-green-600';
}

// 便ごとの積載量バッジ（loadBarColorと同じ3段階のしきい値）。「割当済み」欄で、
// どの便が容量に余裕があり、どの便が警告対象かを一目で区別できるようにする
function loadBadge(ratio: number): { label: string; className: string } {
  if (ratio > 1) return { label: '容量超過', className: 'bg-red-100 text-red-700' };
  if (ratio >= WARNING_USAGE_RATIO) return { label: '残りわずか', className: 'bg-amber-100 text-amber-700' };
  return { label: '正常', className: 'bg-green-100 text-green-700' };
}

type Location = { id: string; name: string; address: string; city: string; lat: number; lng: number };
type Truck = { id: string; plateNo: string; status: string; defaultDriverId: string | null; capacityM3: number | null };
type Driver = { id: string; name: string; type: DriverType };

type ApiPackage = { id: string; productId: string | null; name: string; width: number; depth: number; height: number };
type ApiStop = {
  id: string;
  locationId: string;
  stopOrder: number;
  status: string;
  scheduledTime: string | null;
  requestedArrivalTime: string | null;
  isTimeFixed: boolean;
  hasTimeConflict: boolean;
  // 稼働開始後に「配送先の割当」で追加された停車地か。falseは出発時から積んでいた分
  addedAfterDeparture: boolean;
  // このルートの中でどの便（RouteTrip）の荷物か。null＝便を使わない今まで通りの単一ルート扱い
  tripId: string | null;
  location: Location;
  packages: ApiPackage[];
};
// 複数便対応フェーズ2：1つのルート（トラック1台分）の中で、出発前の計画段階から
// 「今日は何便に分けるか」を決めるための単位。1件も無ければ今まで通りの単一連続ルート
type ApiTrip = {
  id: string;
  tripIndex: number;
  departureTime: string | null;
  returnedAt: string | null;
  status: RouteStatus;
};
// トラック1台分の配送ルート。以前はDeliveryPlanの下に複数ぶら下がっていたが、
// プラン廃止によりこれ自体が最小の管理単位になった
type ApiRoute = {
  id: string;
  truckId: string;
  driverId: string;
  routeDate: string;
  departureTime: string | null;
  status: RouteStatus;
  note: string | null;
  truck: Truck;
  driver: Driver;
  stops: ApiStop[];
  trips: ApiTrip[];
};
type StopUnassignedReason = 'SIZE_OVER' | 'CAPACITY_OVER';
const UNASSIGNED_REASON_LABELS: Record<StopUnassignedReason, string> = {
  SIZE_OVER: 'サイズ超過',
  CAPACITY_OVER: '容積不足',
};
type Suggestion = { routeId: string; truckId: string; stops: { stopId: string; locationId: string; locationName: string }[] };
type SuggestedUnassigned = {
  stopId: string;
  locationId: string;
  locationName: string;
  reason: StopUnassignedReason;
  totalVolume: number;
};

export default function PlanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { confirmDialog, warnDialog } = useDialog();
  // URLの[id]は配送ルート（トラック1台分）のID。過去は複数トラックを束ねる配送計画のIDだったが、
  // 配送計画（DeliveryPlan）は2026-07-29に廃止し、ルート自体が管理単位になった
  const anchorRouteId = params.id as string;

  const [anchor, setAnchor] = useState<ApiRoute | null>(null);
  // 「使用可能なトラックを選ぶ」でまとめて作成・編集する対象の集合。稼働中ルート編集時は自分自身のみ
  const [siblingRoutes, setSiblingRoutes] = useState<ApiRoute[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 「削除」は普段は使わない操作のため、押した直後に即実行せず、まず対象トラックを選ばせる
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteTargetRouteId, setDeleteTargetRouteId] = useState('');

  // Step1（稼働中ルート編集時の「配送先の割当」でのみ使用）
  const [planDate, setPlanDate] = useState('');
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set());
  const [arrivalTimes, setArrivalTimes] = useState<Record<string, string>>({});
  const [packages, setPackages] = useState<Record<string, PackageRow[]>>({});
  // 稼働中ルートの「配送先の割当」で、選択した配送先がプール（荷物受付）由来の場合に
  // locationId → プール停車地IDを記録する。/optimizeへpoolStopIdsとして渡し、
  // 新規作成ではなく既存のプール停車地を再利用してもらう（重複停車地の防止）
  const [poolStopIdByLocationId, setPoolStopIdByLocationId] = useState<Record<string, string>>({});
  const [editHorizonDays, setEditHorizonDays] = useState(10);

  // 配送先の割当（稼働開始前のみ使用。プールはルートに非依存＝/api/poolから取得）
  const [poolStops, setPoolStops] = useState<ApiStop[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestedUnassigned, setSuggestedUnassigned] = useState<SuggestedUnassigned[]>([]);
  const [splittingStopId, setSplittingStopId] = useState<string | null>(null);
  const [splitPackageIds, setSplitPackageIds] = useState<Set<string>>(new Set());
  // 未割当の配送先をトラックへ割り当てる際、プルダウンで選んだだけでは確定せず、
  // 「割り当てる」ボタンを押すまでは選択内容をここに保持するだけにする
  // （選んだ瞬間に割当済みへ移動してしまい、選び直しにくいというフィードバックへの対応）
  const [pendingAssignByStopId, setPendingAssignByStopId] = useState<Record<string, string>>({});

  // 稼働中ルート編集専用（トラック・ドライバーは変更不可の単一組）
  const [assignments, setAssignments] = useState<{ truckId: string; driverId: string }[]>([
    { truckId: '', driverId: '' },
  ]);
  const [assignmentWarning, setAssignmentWarning] = useState('');
  const [checkingAssignment, setCheckingAssignment] = useState(false);

  // 稼働中ルートでも「配送先の割当」に本日のプール（未割当）一覧を表示するため、
  // poolStops自体はstartedを問わず取得する。AI提案（suggest）は出発前のみ対象
  // （稼働中への対象範囲拡張は別途検討）なのでincludeSuggestionsで切り替える
  async function loadPoolAndSuggestions(dateStr: string, includeSuggestions: boolean) {
    const poolRes = await fetch(`/api/pool?date=${dateStr}`);
    const poolData = await poolRes.json();
    setPoolStops(poolData.unassignedStops ?? []);
    if (includeSuggestions) {
      const suggestRes = await fetch(`/api/plans/${anchorRouteId}/suggest`);
      const suggestData = await suggestRes.json();
      setSuggestions(suggestData.suggestions ?? []);
      setSuggestedUnassigned(suggestData.unassignedStops ?? []);
    } else {
      setSuggestions([]);
      setSuggestedUnassigned([]);
    }
  }

  function applyAssignmentRoutes(assignmentRoutes: ApiRoute[]) {
    setSiblingRoutes(assignmentRoutes);

    const ids = new Set<string>();
    const times: Record<string, string> = {};
    const pkgs: Record<string, PackageRow[]> = {};
    assignmentRoutes.flatMap(r => r.stops).forEach(s => {
      ids.add(s.locationId);
      if (s.isTimeFixed && s.requestedArrivalTime) times[s.locationId] = format(new Date(s.requestedArrivalTime), 'HH:mm');
      pkgs[s.locationId] = groupPackagesByProduct(s.packages);
    });
    setSelectedLocationIds(ids);
    setArrivalTimes(times);
    setPackages(pkgs);
    setPoolStopIdByLocationId({});
  }

  // 稼働中でなければ、同日でまだ稼働していないルート一式を「このバッチ」として扱う。
  // 「参考の割当案をすべて反映」等の一括操作は常にこの画面に表示されているトラックだけを対象にする
  async function resolveAssignmentRoutes(anchorData: ApiRoute): Promise<ApiRoute[]> {
    if (anchorData.status !== 'PENDING') {
      return [anchorData];
    }
    const dateStr = format(new Date(anchorData.routeDate), 'yyyy-MM-dd');
    const dayRes = await fetch(`/api/plans?date=${dateStr}`);
    const dayRoutes: ApiRoute[] = await dayRes.json();
    const assignmentRoutes = dayRoutes.filter(r => r.status === 'PENDING');
    return assignmentRoutes;
  }

  async function fetchAll() {
    const [routeRes, truckRes, driverRes, settingsRes] = await Promise.all([
      fetch(`/api/plans/${anchorRouteId}`),
      fetch('/api/trucks'),
      fetch('/api/drivers?status=ACTIVE'),
      fetch('/api/settings'),
    ]);
    if (!routeRes.ok) {
      router.push('/plans');
      return;
    }
    const anchorData: ApiRoute = await routeRes.json();
    setAnchor(anchorData);
    setPlanDate(format(new Date(anchorData.routeDate), 'yyyy-MM-dd'));
    setTrucks(await truckRes.json());
    setDrivers(await driverRes.json());
    const settingsData = await settingsRes.json();
    setEditHorizonDays(settingsData.truckScheduleHorizonDays ?? 10);

    const started = anchorData.status !== 'PENDING';
    const assignmentRoutes = await resolveAssignmentRoutes(anchorData);
    applyAssignmentRoutes(assignmentRoutes);

    setAssignments([{ truckId: anchorData.truckId, driverId: anchorData.driverId }]);

    await loadPoolAndSuggestions(format(new Date(anchorData.routeDate), 'yyyy-MM-dd'), !started);
  }

  async function refreshPlanAndAssignments() {
    const routeRes = await fetch(`/api/plans/${anchorRouteId}`);
    if (!routeRes.ok) {
      router.push('/plans');
      return;
    }
    const anchorData: ApiRoute = await routeRes.json();
    setAnchor(anchorData);
    const started = anchorData.status !== 'PENDING';
    const assignmentRoutes = await resolveAssignmentRoutes(anchorData);
    applyAssignmentRoutes(assignmentRoutes);
    await loadPoolAndSuggestions(format(new Date(anchorData.routeDate), 'yyyy-MM-dd'), !started);
  }

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorRouteId]);


  function timeToIso(time: string): string | null {
    if (!time) return null;
    return new Date(`${planDate}T${time}:00`).toISOString();
  }

  if (!anchor) return <p className="text-gray-500">読み込み中...</p>;

  const editWarning = getEditWarning({ status: anchor.status, routeDate: new Date(anchor.routeDate) }, editHorizonDays);
  const editable = editWarning !== 'locked';
  const started = anchor.status !== 'PENDING';
  // 便は tripIndex 昇順のため、完了していない最初の便が「現在稼働中の便」
  const currentTrip = anchor.trips.find(t => t.status !== 'COMPLETED') ?? null;
  const conflictLocationNames = siblingRoutes.flatMap(r => r.stops.filter(s => s.hasTimeConflict).map(s => s.location.name));
  const fixedLocationInfo = new Map<string, 'COMPLETED' | 'SKIPPED'>();
  siblingRoutes.forEach(r =>
    r.stops.forEach(s => {
      if (s.status !== 'PENDING') fixedLocationInfo.set(s.locationId, s.status as 'COMPLETED' | 'SKIPPED');
    })
  );

  const minDate = format(new Date(), 'yyyy-MM-dd');
  const maxDate = format(addDays(new Date(), editHorizonDays), 'yyyy-MM-dd');

  // 稼働中ルートの「配送先の割当」で、既にこのルートへ割当済み（保存済み）かつ未完了（status: PENDING）の停車地。
  // 「未割当に戻す」の対象一覧に使う。出発時から積んでいた分（addedAfterDeparture: false）は
  // 物理的にトラック上にあり画面操作だけでは戻せないため対象外とし、稼働開始後にこの画面で
  // 追加した分のみを対象にする。selectedLocationIdsで絞るのは、ローカルで解除操作をした
  // 直後に一覧からすぐ消える（保存前のプレビュー）ようにするため
  const assignedPendingStops = (siblingRoutes[0]?.stops ?? []).filter(
    s => s.status === 'PENDING' && s.addedAfterDeparture && selectedLocationIds.has(s.locationId)
  );
  // 「未割当に戻す」を押した直後（保存前）に「配送先の割当」一覧へ即座に表示するための、
  // ローカルでのプレビュー分。selectedLocationIdsから外れた＝解除操作をした対象なので、
  // 実際にプールに保存されるまでの間、ここに一時的に含める
  const locallyUnassignedStops = (siblingRoutes[0]?.stops ?? []).filter(
    s => s.status === 'PENDING' && s.addedAfterDeparture && !selectedLocationIds.has(s.locationId)
  );
  const displayPoolStops = [...poolStops, ...locallyUnassignedStops];
  // 「変更を保存する」の排他制御用：「配送先の割当」で新たにチェックした（poolStopIdByLocationIdが
  // 空でない）か、「未割当に戻す」で解除した（locallyUnassignedStopsが空でない）、どちらか一方でも
  // あれば保存可能にする。保存成功後はどちらも空に戻るため、押しっぱなしの二重送信も自然に防げる
  const hasPendingPoolChanges = Object.keys(poolStopIdByLocationId).length > 0 || locallyUnassignedStops.length > 0;
  // 稼働中ルートのドライバー変更（2026-08-27決定）。プール変更がなくても、ドライバーだけ
  // 変更した場合に「変更を保存する」を押せるようにするための判定
  const hasDriverChange = started && assignments[0].driverId !== '' && assignments[0].driverId !== anchor.driverId;

  // 見出しの「新規/編集/参照」バッジ：どこから来たか（URL）ではなく、このバッチに停車地が
  // 1件でも割当済みかどうかで判定する。ただし対象日が過去なら常に「参照」（閲覧のみの意味合い）
  const hasAnyAssignedStop = siblingRoutes.some(r => r.stops.length > 0);
  const today = format(new Date(), 'yyyy-MM-dd');
  const isPastDate = planDate !== '' && planDate < today;

  const routeLabel = (r: ApiRoute) => `${r.truck.plateNo}（${r.driver.name}）`;
  // 「トラックへ割当」の選択肢：このバッチ（同日でまだ稼働していないルート一式）のみ。
  // ルートは常に便を1件以上持つ。1便しかないトラックは今まで通り1つの選択肢（「・N便」を付けない）、
  // 2便以上のトラックは便の数だけ選択肢になる。値は常に`routeId::tripId`でエンコードする
  type AssignmentOption = { value: string; label: string; routeId: string; tripId: string | null };
  const assignmentRouteOptions: AssignmentOption[] = siblingRoutes.flatMap((r): AssignmentOption[] =>
    r.trips.length <= 1
      ? [{ value: `${r.id}::${r.trips[0].id}`, label: routeLabel(r), routeId: r.id, tripId: r.trips[0].id }]
      : r.trips.map(t => ({
          value: `${r.id}::${t.id}`,
          label: `${routeLabel(r)}・${t.tripIndex + 1}便`,
          routeId: r.id,
          tripId: t.id,
        }))
  );
  function parseAssignmentValue(value: string): { routeId: string; tripId: string | null } {
    const [routeId, tripId] = value.split('::');
    return { routeId, tripId: tripId ?? null };
  }

  // 「割当済み」一覧の停車地1行分。便を使うトラック・使わないトラックの両方から共通で呼ぶ。
  // currentValueは現在の割当先（便がある場合は`routeId::tripId`、無ければ`routeId`のみ、
  // 便未指定の異常系は空文字＝プルダウン上「未割当に戻す」相当の表示になる）
  function renderAssignedStopRow(s: ApiStop, currentValue: string) {
    return (
      <li key={s.id} className="flex items-center gap-2 text-sm">
        <span className="flex-1 truncate">
          {s.location.name}
          <span className="ml-1 text-xs text-gray-600">
            （{s.location.city}・{stopVolume(s.packages).toFixed(2)}m3）
          </span>
        </span>
        {s.hasTimeConflict && (
          <span
            className="shrink-0 rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
            title="移動時間の都合で到着希望時刻に間に合わない可能性があります"
          >
            時刻超過
          </span>
        )}
        <select
          value={currentValue}
          disabled={!editable || busy}
          onChange={e => {
            if (!e.target.value) {
              handleAssignStop(s.id, null, null);
              return;
            }
            const { routeId, tripId } = parseAssignmentValue(e.target.value);
            handleAssignStop(s.id, routeId, tripId);
          }}
          className="shrink-0 rounded border border-gray-300 px-1 py-0.5 text-xs"
        >
          <option value="">未割当に戻す</option>
          {assignmentRouteOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </li>
    );
  }
  const suggestionRouteIdByStopId = new Map<string, string>();
  suggestions.forEach(s => s.stops.forEach(st => suggestionRouteIdByStopId.set(st.stopId, s.routeId)));
  const suggestionReasonByStopId = new Map(suggestedUnassigned.map(u => [u.stopId, u.reason]));
  const routeLabelById = new Map(siblingRoutes.map(r => [r.id, routeLabel(r)]));


  // 稼働中ルートの「配送先の割当」用。選択を解除し、関連するステートを一括でクリアする。
  // 「変更を保存する」を押すまでは確定しないため、既にこのルートへ割当済み（保存済み）の
  // 停車地に対して呼んだ場合は、保存時にoptimize側が未割当（プール）へ戻す処理を行う
  function unassignLocation(id: string) {
    setSelectedLocationIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setArrivalTimes(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setPackages(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setPoolStopIdByLocationId(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  // 稼働中ルートの「配送先の割当」用。プール（荷物受付）の停車地をチェック/解除する。
  // 選んだ時点で、プールに既に登録済みの到着希望時刻・荷物をそのまま流し込む
  // （再入力不要）。/optimize呼び出し時にpoolStopIdByLocationIdからpoolStopIdsを組み立てる
  function togglePoolStopSelection(stop: ApiStop) {
    const id = stop.locationId;
    if (selectedLocationIds.has(id)) {
      unassignLocation(id);
    } else {
      setSelectedLocationIds(prev => new Set(prev).add(id));
      if (stop.requestedArrivalTime) {
        setArrivalTimes(prev => ({ ...prev, [id]: format(new Date(stop.requestedArrivalTime as string), 'HH:mm') }));
      }
      setPackages(prev => ({ ...prev, [id]: groupPackagesByProduct(stop.packages) }));
      setPoolStopIdByLocationId(prev => ({ ...prev, [id]: stop.id }));
    }
  }

  async function savePlanDate(): Promise<boolean> {
    const res = await fetch(`/api/plans/${anchorRouteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 稼働中ルートは対象日入力自体を無効化しているため送らない（サーバー側も稼働中の
        // routeDate変更を拒否するようになったため、送ると常にエラーになってしまう）
        ...(!started && { routeDate: planDate }),
        // 稼働中ルートのドライバー変更（2026-08-27決定）。トラックは今回対象外のため送らない
        ...(started && { driverId: assignments[0].driverId }),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setAnchor(prev => (prev ? { ...prev, routeDate: data.routeDate, driverId: data.driverId } : prev));
    return true;
  }

  // 稼働中ルート編集専用（トラック・ドライバーが単一組に固定されている場合のみ使用）
  async function saveAssignmentAndDate(): Promise<boolean> {
    const checkRes = await fetch(`/api/plans/${anchorRouteId}/check-assignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ truckId: assignments[0].truckId, driverId: assignments[0].driverId }),
    });
    const checkData = await checkRes.json();
    if (!checkRes.ok) throw new Error(checkData.error);
    return savePlanDate();
  }

  function packagesPayload(): Record<string, { productId: string; name: string; width: number; depth: number; height: number }[]> {
    const editableLocationIds = Array.from(selectedLocationIds).filter(id => !fixedLocationInfo.has(id));
    return Object.fromEntries(
      Object.entries(packages)
        .filter(([id]) => editableLocationIds.includes(id))
        .map(([id, pkgs]) => [
          id,
          pkgs
            .filter(p => p.productId)
            .flatMap(p =>
              Array.from({ length: Math.max(1, Number(p.quantity) || 1) }, () => ({
                productId: p.productId,
                name: p.name,
                width: Number(p.width),
                depth: Number(p.depth),
                height: Number(p.height),
              }))
            ),
        ])
    );
  }

  async function checkAssignment(truckId: string, driverId: string) {
    if (!truckId || !driverId) {
      setAssignmentWarning('');
      return;
    }
    setCheckingAssignment(true);
    try {
      const res = await fetch(`/api/plans/${anchorRouteId}/check-assignment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ truckId, driverId }),
      });
      const data = await res.json();
      setAssignmentWarning(res.ok ? '' : data.error);
    } catch {
      setAssignmentWarning('');
    } finally {
      setCheckingAssignment(false);
    }
  }

  function updateAssignment(index: number, field: 'truckId' | 'driverId', value: string) {
    setAssignments(prev => {
      const next = prev.map((a, i) => (i === index ? { ...a, [field]: value } : a));
      const a = next[index];
      checkAssignment(a.truckId, a.driverId);
      return next;
    });
  }

  async function handleAssignStop(stopId: string, targetRouteId: string | null, targetTripId: string | null = null) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/stops/${stopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeId: targetRouteId, tripId: targetTripId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.warnings?.length > 0) {
        await warnDialog(data.warnings);
      }
      await refreshPlanAndAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : '割当の更新に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  // 未割当リストの「割り当てる」ボタン用。プルダウンで選んだだけの内容（pendingAssignByStopId）を
  // ここで初めて確定する
  async function handleConfirmAssignStop(stopId: string) {
    const value = pendingAssignByStopId[stopId];
    if (!value) return;
    const { routeId, tripId } = parseAssignmentValue(value);
    await handleAssignStop(stopId, routeId, tripId);
    setPendingAssignByStopId(prev => {
      const next = { ...prev };
      delete next[stopId];
      return next;
    });
  }

  // トラック・ドライバーの枠（PlanRoute）自体は残したまま、割当済みの荷物だけを未割当（プール）へ戻す。
  // トラックの枠ごと消したい場合は画面右上の「削除」（このルート自身のみ対象）を使う
  async function handleUnassignAllStops(targetRouteId: string) {
    const target = siblingRoutes.find(r => r.id === targetRouteId);
    const stopIds = target ? target.stops.map(s => s.id) : [];
    if (stopIds.length === 0) return;
    if (!(await confirmDialog('このトラックに割り当てられている荷物をすべて未割当（プール）に戻しますか？'))) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      for (const stopId of stopIds) {
        const res = await fetch(`/api/stops/${stopId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ routeId: null }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
      }
      await refreshPlanAndAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : '未割当への変更に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  // 複数便対応フェーズ2：このトラックに新しい便を追加する（出発前の計画段階のみ）
  async function handleAddTrip(targetRouteId: string) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/plans/${targetRouteId}/trips`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await refreshPlanAndAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : '便の追加に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  // 最後の便を削除する。トラックカード見出しの「－便を削除」・割当済み一覧の「この便を削除」の両方から呼ぶ
  async function handleDeleteTrip(targetRouteId: string, tripId: string) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/plans/${targetRouteId}/trips/${tripId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await refreshPlanAndAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : '便の削除に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  function toggleSplitPanel(stopId: string) {
    setSplittingStopId(prev => (prev === stopId ? null : stopId));
    setSplitPackageIds(new Set());
  }

  function toggleSplitPackage(packageId: string) {
    setSplitPackageIds(prev => {
      const next = new Set(prev);
      if (next.has(packageId)) next.delete(packageId);
      else next.add(packageId);
      return next;
    });
  }

  async function handleSplitStop(stopId: string) {
    if (splitPackageIds.size === 0) {
      setError('新しい停車地に移す荷物を1件以上選択してください');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/stops/${stopId}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageIds: Array.from(splitPackageIds) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSplittingStopId(null);
      setSplitPackageIds(new Set());
      await refreshPlanAndAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : '停車地の分割に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptSuggestions() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/plans/${anchorRouteId}/assign-suggested`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.warnings?.length > 0) {
        await warnDialog(data.warnings);
      }
      await refreshPlanAndAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : '参考案の反映に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  // 呼び出し元（handleReturnToList）が保存の成否を見て次の動作（一覧への遷移）を
  // 判断できるよう、成功したかどうかをbooleanで返す
  async function handleOptimize(force = false): Promise<boolean> {
    if (started && anchor && assignments[0].driverId !== anchor.driverId) {
      const newDriverName = drivers.find(d => d.id === assignments[0].driverId)?.name ?? assignments[0].driverId;
      const ok = await confirmDialog(
        `ドライバーを${anchor.driver.name}から${newDriverName}に変更しますか？`,
        { variant: 'danger' }
      );
      if (!ok) return false;
    }
    setBusy(true);
    setError('');
    try {
      const valid = assignments.filter(a => a.truckId && a.driverId);
      if (valid.length === 0) {
        throw new Error('トラックとドライバーを1組以上設定してください');
      }
      const editableLocationIds = Array.from(selectedLocationIds).filter(id => !fixedLocationInfo.has(id));
      const arrivalTimesIso = Object.fromEntries(
        Object.entries(arrivalTimes)
          .filter(([id, time]) => selectedLocationIds.has(id) && !fixedLocationInfo.has(id) && time)
          .map(([id, time]) => [id, timeToIso(time)])
      );
      const poolStopIdsForSelected = Object.fromEntries(
        Object.entries(poolStopIdByLocationId).filter(([id]) => editableLocationIds.includes(id))
      );
      await saveAssignmentAndDate();
      const res = await fetch(`/api/plans/${anchorRouteId}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationIds: editableLocationIds,
          truckIds: valid.map(a => a.truckId),
          driverIds: valid.map(a => a.driverId),
          arrivalTimes: arrivalTimesIso,
          packages: packagesPayload(),
          poolStopIds: poolStopIdsForSelected,
          force,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && !force) {
          if (await confirmDialog('既存のルートを再生成して上書きしますか？')) {
            return handleOptimize(true);
          }
          return false;
        }
        throw new Error(data.error);
      }
      // siblingRoutes・poolStops・poolStopIdByLocationIdもここで最新化しないと、
      // 保存直後も「配送先の割当」「稼働開始後に追加した停車地」一覧や
      // 「変更を保存する」の排他判定（hasPendingPoolChanges）が古いままになる
      await refreshPlanAndAssignments();
      if (data.warnings?.length > 0) {
        await warnDialog(data.warnings);
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(targetRouteId: string) {
    const target = siblingRoutes.find(r => r.id === targetRouteId) ?? (targetRouteId === anchorRouteId ? anchor : null);
    if (!target) return;
    const targetStarted = target.status !== 'PENDING';

    let confirmRouteDate: string | undefined;
    if (targetStarted) {
      const expected = format(new Date(target.routeDate), 'yyyy-MM-dd');
      const input = window.prompt(
        `${target.truck.plateNo}（${target.driver.name}）は運送が開始されているルートです。削除するには対象日（${expected}）を入力してください。`
      );
      if (input === null) return;
      if (input !== expected) {
        setError('入力された対象日が一致しないため削除を中止しました');
        return;
      }
      if (
        !(await confirmDialog(`${target.truck.plateNo}（${target.driver.name}）を本当に削除してよいですか？この操作は取り消せません。`, {
          variant: 'danger',
        }))
      )
        return;
      confirmRouteDate = input;
    } else if (
      !(await confirmDialog(
        `${target.truck.plateNo}（${target.driver.name}）の配送ルートを削除しますか？この操作は取り消せません。`,
        { variant: 'danger' }
      ))
    ) {
      return;
    }

    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/plans/${target.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: confirmRouteDate ? JSON.stringify({ confirmRouteDate }) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDeleteMode(false);
      setDeleteTargetRouteId('');
      if (target.id === anchorRouteId) {
        // 今開いているトラック自身を削除した場合は、この画面から離れる必要があるため
        // 残っている別のトラックへ切り替える（1台も残っていなければ一覧へ戻る）
        const remaining = siblingRoutes.filter(r => r.id !== target.id);
        if (remaining.length > 0) {
          router.push(`/plans/${remaining[0].id}`);
        } else {
          router.push(`/plans?date=${planDate}`);
        }
      } else {
        // 他のトラックを削除した場合は、この画面にとどまり最新の状態を再取得する
        await refreshPlanAndAssignments();
        setBusy(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました');
      setBusy(false);
      setDeleteMode(false);
      setDeleteTargetRouteId('');
    }
  }

  async function handleReturnToList() {
    if (started && (hasPendingPoolChanges || hasDriverChange)) {
      const shouldSave = await confirmDialog(
        '保存されていない変更があります。保存してから一覧に戻りますか？',
        { confirmLabel: '保存して戻る', cancelLabel: '保存せず戻る' }
      );
      if (shouldSave) {
        const saved = await handleOptimize(false);
        if (!saved) return;
      }
    }
    router.push(`/plans?date=${planDate}`);
  }

  const deleteControls = !deleteMode ? (
    <button
      onClick={() => setDeleteMode(true)}
      disabled={busy}
      className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      トラックの削除
    </button>
  ) : (
    <div className="flex items-center gap-2">
      <select
        value={deleteTargetRouteId}
        onChange={e => setDeleteTargetRouteId(e.target.value)}
        disabled={busy}
        className="rounded border border-red-300 px-2 py-1.5 text-sm"
      >
        <option value="">削除するトラックを選択...</option>
        {siblingRoutes.map(r => (
          <option key={r.id} value={r.id}>
            {r.truck.plateNo}（{r.driver.name}）
          </option>
        ))}
      </select>
      <button
        onClick={() => handleDelete(deleteTargetRouteId)}
        disabled={busy || !deleteTargetRouteId}
        className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        削除する
      </button>
      <button
        onClick={() => {
          setDeleteMode(false);
          setDeleteTargetRouteId('');
        }}
        disabled={busy}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
      >
        キャンセル
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardCheck}
        tint="blueSoft"
        title={
          <span className="flex items-center gap-2">
            {started ? '稼働後ルートの編集' : '配送計画の作成'}
            {!started && (
              <span
                className={`rounded-full px-3 py-1 text-sm font-bold text-white ${
                  isPastDate ? 'bg-gray-500' : hasAnyAssignedStop ? 'bg-orange-500' : 'bg-indigo-600'
                }`}
              >
                {isPastDate ? '参照' : hasAnyAssignedStop ? '編集' : '新規'}
              </span>
            )}
          </span>
        }
        description={
          started
            ? '本日分のルートに配送先の追加・変更を行います。配送中のルートに影響する可能性があるため注意してください。'
            : 'トラックに配送先・荷物を割当てます。'
        }
        action={
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              ROUTE_OPERATION_STATUS_STYLES[
                computeRouteOperationStatus(anchor.status, anchor.stops.some(s => s.status === 'COMPLETED'))
              ]
            }`}
          >
            {
              ROUTE_OPERATION_STATUS_LABELS[
                computeRouteOperationStatus(anchor.status, anchor.stops.some(s => s.status === 'COMPLETED'))
              ]
            }
          </span>
        }
      />

      {!editable && (
        <div className="rounded bg-gray-100 p-3 text-sm text-gray-600">
          このルートは編集できません（対象期間外）。
        </div>
      )}
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      <div className="space-y-4">
          <div className="flex gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">対象日</label>
              <div className="mt-1 flex items-center gap-3">
                {/* 稼働中・完了済みルートは、既にそのルートに紐づく配送先の対象日
                    （DeliveryStop.stopDate）が固定されているため対象日を変更できない。
                    無効化した入力欄をそのまま残すと壊れて見えるため、下のテキスト表示のみにする */}
                {!started && (
                  <input
                    type="date"
                    value={planDate}
                    min={minDate}
                    max={maxDate}
                    disabled={!editable}
                    onChange={e => setPlanDate(e.target.value)}
                    className="rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                )}
                {planDate && (
                  <p className="text-[22px] font-semibold text-gray-800">
                    {planDate.slice(5, 7)}/{planDate.slice(8, 10)}
                  </p>
                )}
                <RelativeDayBadge date={planDate} />
              </div>
            </div>
          </div>

          {started ? (
            <div className="rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] p-3 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-gray-700">トラック・ドライバーの割当</h2>
              <div className="flex items-center gap-2">
                <select
                  value={assignments[0].truckId}
                  disabled
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                >
                  <option value="">トラックを選択</option>
                  {trucks.map(t => (
                    <option key={t.id} value={t.id}>{t.plateNo}</option>
                  ))}
                </select>
                <select
                  value={assignments[0].driverId}
                  onChange={e => updateAssignment(0, 'driverId', e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                >
                  <option value="">ドライバーを選択</option>
                  {drivers.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name}（{DRIVER_TYPE_LABELS[d.type]}）
                    </option>
                  ))}
                </select>
              </div>
              {siblingRoutes[0] && (() => {
                const used = routeLoad(siblingRoutes[0]);
                const capacity = siblingRoutes[0].truck.capacityM3;
                const ratio = capacity ? used / capacity : null;
                return (
                  <div className="mt-2 max-w-xs">
                    {ratio !== null ? (
                      <>
                        <div className="flex items-center justify-between text-xs text-[#4B5563]">
                          <span>{used.toFixed(2)} / {capacity!.toFixed(2)} m3</span>
                          <span>{Math.round(ratio * 100)}%</span>
                        </div>
                        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                          <div
                            className={`h-full ${loadBarColor(ratio)}`}
                            style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-[#4B5563]">容積上限未設定</p>
                    )}
                  </div>
                );
              })()}
              <p className="mt-2 text-xs text-[#4B5563]">運行中のためトラックは変更できません。</p>
              {checkingAssignment && <p className="mt-2 text-xs text-[#4B5563]">重複を確認中...</p>}
              {assignmentWarning && (
                <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-600">{assignmentWarning}</p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700">使用中のトラック</h2>
                {deleteControls}
              </div>
              <ul className="divide-y divide-gray-200 text-sm text-gray-700">
                {siblingRoutes.map(r => {
                  const isCurrent = r.id === anchorRouteId;
                  const used = routeLoad(r);
                  const capacity = r.truck.capacityM3;
                  const ratio = capacity ? used / capacity : null;
                  const lastTrip = r.trips[r.trips.length - 1];
                  const lastTripStopCount = r.stops.filter(s => s.tripId === lastTrip.id).length;
                  const canDeleteLastTrip = r.trips.length > 1 && lastTripStopCount === 0;
                  const deleteLastTripReason =
                    r.trips.length <= 1
                      ? '最後の1便は削除できません'
                      : lastTripStopCount > 0
                      ? 'この便に配送先が割り当てられているため削除できません'
                      : undefined;
                  return (
                    <li key={r.id} className="py-1.5 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => !isCurrent && router.push(`/plans/${r.id}`)}
                          className={`flex flex-1 items-center gap-2 rounded border border-transparent px-2 py-1 text-left ${
                            isCurrent ? 'cursor-default' : 'hover:border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          {r.truck.plateNo}（{r.driver.name}）
                          {r.trips.length > 1 ? (
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                              {r.trips.length}便
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                              1便のみ
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTrip(r.id, lastTrip.id)}
                          disabled={!editable || busy || !canDeleteLastTrip}
                          title={deleteLastTripReason}
                          className="shrink-0 rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          －便を削除
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddTrip(r.id)}
                          disabled={!editable || busy}
                          className="shrink-0 rounded border border-blue-300 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                        >
                          ＋便を追加
                        </button>
                      </div>
                      <div className="px-2">
                        {ratio !== null ? (
                          <>
                            <div className="flex items-center justify-between text-xs text-[#4B5563]">
                              <span>{used.toFixed(2)} / {capacity!.toFixed(2)} m3</span>
                              <span>{Math.round(ratio * 100)}%</span>
                            </div>
                            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                              <div
                                className={`h-full ${loadBarColor(ratio)}`}
                                style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                              />
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-[#4B5563]">容積上限未設定</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-[#4B5563]">
                トラックの構成は
                <a href={`/truck-schedule?date=${planDate}`} className="mx-1 font-medium text-blue-600 underline">
                  稼働トラックの登録
                </a>
                で管理します。
              </p>
            </div>
          )}

          {started ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-700">（稼働後に追加された）配送先の割当</h2>
                  <span className="text-xs text-[#4B5563]">
                    選択済み: {selectedLocationIds.size}件
                  </span>
                </div>
                {currentTrip && (
                  <p className="mb-2 text-xs text-[#4B5563]">
                    現在{currentTrip.tripIndex + 1}便目で稼働中（配送先を追加すると本社経由で新しい便を作ります）
                  </p>
                )}
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <h3 className="mb-2 text-xs font-semibold text-amber-900">未割当（{displayPoolStops.length}件）</h3>
                  {displayPoolStops.length === 0 ? (
                    <p className="text-xs text-amber-700">
                      本日プールに登録されている未割当の配送先はありません。
                      <a href={`/pool?date=${planDate}`} className="mx-1 font-medium text-blue-600 underline">
                        荷物受付画面
                      </a>
                      から追加してください。
                    </p>
                  ) : (
                    <ul className="max-h-80 space-y-1 overflow-y-auto">
                      {displayPoolStops.map(stop => {
                        const checked = selectedLocationIds.has(stop.locationId);
                        return (
                          <li key={stop.id} className="rounded border border-gray-100 bg-white px-2 py-1.5 text-sm">
                            <label className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!editable || busy}
                                onChange={() => togglePoolStopSelection(stop)}
                                className="mt-0.5"
                              />
                              <span className="flex-1">
                                <span className="block truncate">
                                  {stop.location.name}
                                  <span className="ml-1 text-xs text-[#4B5563]">
                                    （{stop.location.city}・{stopVolume(stop.packages).toFixed(2)}m3
                                    {stop.requestedArrivalTime && `・希望${format(new Date(stop.requestedArrivalTime), 'HH:mm')}`}）
                                  </span>
                                </span>
                                {stop.packages.length > 0 ? (
                                  <span className="mt-0.5 block text-xs text-[#4B5563]">
                                    {groupPackagesForDisplay(stop.packages)
                                      .map(g => `${g.name}（${g.width}×${g.depth}×${g.height}m）${g.count > 1 ? ` × ${g.count}` : ''}`)
                                      .join('、')}
                                  </span>
                                ) : (
                                  <span className="mt-0.5 block text-xs text-[#4B5563]">荷物登録なし</span>
                                )}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="my-2 flex justify-center">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100"
                    title="配送先をチェックして保存すると、この下の一覧に移動します"
                  >
                    <ArrowUpDown className="h-[18px] w-[18px] text-blue-700" aria-hidden="true" />
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <h3 className="mb-2 text-xs font-semibold text-gray-500">
                    （稼働後に追加された）配送先　－未完了・{assignedPendingStops.length}件－
                  </h3>
                  {assignedPendingStops.length === 0 ? (
                    <p className="text-xs text-gray-600">（稼働後に追加された）配送先はありません。</p>
                  ) : (
                    <ul className="space-y-1">
                      {assignedPendingStops.map(stop => (
                        <li
                          key={stop.id}
                          className="flex items-center gap-2 rounded border border-gray-100 bg-white px-2 py-1.5 text-sm"
                        >
                          <span className="flex-1 truncate">
                            {stop.location.name}
                            <span className="ml-1 text-xs text-[#4B5563]">
                              （{stop.location.city}・{stopVolume(stop.packages).toFixed(2)}m3）
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => unassignLocation(stop.locationId)}
                            disabled={!editable || busy}
                            className="shrink-0 text-xs text-red-500 hover:underline disabled:opacity-50"
                          >
                            未割当に戻す
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              配送先・荷物の登録は
              <a href={`/pool?date=${planDate}`} className="mx-1 font-medium text-blue-600 underline">
                荷物受付画面
              </a>
              で行ってください。トラックが出発する前なら「配送先の割当」から引き続き割り当てられます。
            </p>
          )}

          {!started && siblingRoutes.length > 0 && (
            <div className="rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700">配送先の割当</h2>
                <button
                  onClick={handleAcceptSuggestions}
                  disabled={!editable || busy || poolStops.length === 0}
                  title="「AI提案」は自動割当（FFD）による参考データです"
                  className="rounded bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  「AI提案」の割当案をすべて反映
                </button>
              </div>

              {conflictLocationNames.length > 0 && (
                <p className="mb-3 rounded-lg border border-red-300 bg-red-50 p-2 text-xs font-semibold text-red-800">
                  移動時間の都合で到着希望時刻に間に合わない可能性がある配送先があります（{conflictLocationNames.join('、')}）。
                  トラックの組み合わせを見直すか、到着希望時刻を調整してください。解消するまで確定できません。
                </p>
              )}

              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <h3 className="mb-2 text-xs font-semibold text-amber-900">未割当（{poolStops.length}件）</h3>
                {poolStops.length === 0 ? (
                  <p className="text-xs text-amber-700">未割当の配送先はありません。</p>
                ) : (
                  <ul className="space-y-1">
                    {poolStops.map(stop => {
                      const suggestedRouteId = suggestionRouteIdByStopId.get(stop.id);
                      const suggestedReason = suggestionReasonByStopId.get(stop.id);
                      const splitting = splittingStopId === stop.id;
                      return (
                        <li key={stop.id} className="rounded bg-white px-2 py-1.5">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="flex-1 truncate">
                              {stop.location.name}
                              <span className="ml-1 text-xs text-gray-600">
                                （{stop.location.city}・{stopVolume(stop.packages).toFixed(2)}m3
                                {stop.requestedArrivalTime && `・希望${format(new Date(stop.requestedArrivalTime), 'HH:mm')}`}）
                              </span>
                            </span>
                            {suggestedRouteId && (
                              <span
                                className="shrink-0 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700"
                                title="自動割当（FFD）による参考データです。実際の割当は右のプルダウンで手動確定してください。"
                              >
                                AI提案: {routeLabelById.get(suggestedRouteId)}
                              </span>
                            )}
                            {suggestedReason && (
                              <span className="shrink-0 rounded bg-orange-200 px-2 py-0.5 text-xs font-medium text-orange-900">
                                {UNASSIGNED_REASON_LABELS[suggestedReason]}
                              </span>
                            )}
                            {stop.packages.length >= 2 && (
                              <button
                                type="button"
                                onClick={() => toggleSplitPanel(stop.id)}
                                disabled={!editable || busy}
                                className="shrink-0 text-xs text-blue-600 hover:underline disabled:opacity-50"
                              >
                                {splitting ? '分割をやめる' : '分割'}
                              </button>
                            )}
                            <select
                              key={stop.id}
                              value={pendingAssignByStopId[stop.id] ?? ''}
                              disabled={!editable || busy}
                              onChange={e =>
                                setPendingAssignByStopId(prev => ({ ...prev, [stop.id]: e.target.value }))
                              }
                              className="shrink-0 rounded border border-gray-300 px-1 py-0.5 text-xs"
                            >
                              <option value="">トラックへ割当...</option>
                              {assignmentRouteOptions.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleConfirmAssignStop(stop.id)}
                              disabled={!editable || busy || !pendingAssignByStopId[stop.id]}
                              className="shrink-0 rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              割り当てる
                            </button>
                          </div>
                          {splitting && (
                            <div className="ml-2 mt-1 space-y-1 rounded border border-gray-200 bg-gray-50 p-2">
                              <p className="text-xs text-gray-500">
                                新しい停車地に移す荷物を選択してください（元の停車地には最低1件残ります）。
                              </p>
                              {stop.packages.map(p => (
                                <label key={p.id} className="flex items-center gap-2 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={splitPackageIds.has(p.id)}
                                    onChange={() => toggleSplitPackage(p.id)}
                                  />
                                  <span>{p.name}（{p.width}×{p.depth}×{p.height}m）</span>
                                </label>
                              ))}
                              <div className="flex gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => handleSplitStop(stop.id)}
                                  disabled={busy || splitPackageIds.size === 0}
                                  className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                  分割する
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleSplitPanel(stop.id)}
                                  disabled={busy}
                                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                                >
                                  キャンセル
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="mb-2 flex justify-center">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100"
                  title="配送先をトラックへ割り当てると、この下の「割当済み」に移動します"
                >
                  <ArrowUpDown className="h-[18px] w-[18px] text-blue-700" aria-hidden="true" />
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <h3 className="mb-2 text-xs font-semibold text-gray-500">割当済み</h3>
                {siblingRoutes.every(r => r.stops.length === 0) ? (
                  <p className="text-xs text-gray-600">まだ割当がありません。</p>
                ) : (
                  siblingRoutes
                    .filter(r => r.stops.length > 0)
                    .map(r => {
                      const { prefix, lastFour } = splitPlateNo(r.truck.plateNo);
                      const used = routeLoad(r);
                      const capacity = r.truck.capacityM3;
                      return (
                      <div key={r.id} className="mb-2 rounded bg-white p-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-gray-600">
                            {prefix}
                            <span className="font-bold text-gray-900">{lastFour}</span>
                            （<span className="font-bold text-gray-900">{r.driver.name}</span>）（{r.stops.length}件・
                            {capacity != null ? `${used.toFixed(2)} / ${capacity.toFixed(2)}m3` : `${used.toFixed(2)}m3`}）
                          </p>
                          <button
                            onClick={() => handleUnassignAllStops(r.id)}
                            disabled={!editable || busy}
                            className="text-xs text-red-500 hover:underline disabled:opacity-50"
                          >
                            未割当に戻す
                          </button>
                        </div>
                        {r.trips.length <= 1 ? (
                          <ul className="ml-2 space-y-1">
                            {r.stops.map(s => renderAssignedStopRow(s, `${r.id}::${s.tripId}`))}
                          </ul>
                        ) : (
                          <div className="ml-2 space-y-2">
                            {r.trips.map(t => {
                              const tripStops = r.stops.filter(s => s.tripId === t.id);
                              const tripUsed = routeLoad({ stops: tripStops });
                              const tripRatio = capacity ? tripUsed / capacity : null;
                              const badge = tripRatio !== null ? loadBadge(tripRatio) : null;
                              return (
                                <div key={t.id} className="rounded border border-gray-100 p-1.5">
                                  <div className="mb-1 flex items-center justify-between">
                                    <p className="flex items-center gap-1.5 text-xs font-semibold text-blue-700">
                                      {t.tripIndex + 1}便（{tripStops.length}件・
                                      {capacity != null ? `${tripUsed.toFixed(2)} / ${capacity.toFixed(2)}m3` : `${tripUsed.toFixed(2)}m3`}）
                                      {badge && (
                                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
                                          {badge.label}
                                        </span>
                                      )}
                                    </p>
                                    {r.trips.length > 1 && tripStops.length === 0 && t.tripIndex === r.trips[r.trips.length - 1].tripIndex && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteTrip(r.id, t.id)}
                                        disabled={!editable || busy}
                                        className="shrink-0 text-xs text-red-500 hover:underline disabled:opacity-50"
                                      >
                                        この便を削除
                                      </button>
                                    )}
                                  </div>
                                  {tripStops.length > 0 && (
                                    <ul className="space-y-1">
                                      {tripStops.map(s => renderAssignedStopRow(s, `${r.id}::${t.id}`))}
                                    </ul>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {(() => {
                          // ルートは常に便を1件以上持つ不変条件のため通常は発生しないが、
                          // 念のための安全網として、フラット表示・便別グループ表示どちらのときも
                          // 便未指定の停車地があれば警告表示する
                          const orphanStops = r.stops.filter(s => !s.tripId);
                          return orphanStops.length > 0 ? (
                            <div className="ml-2 mt-2 rounded border border-red-200 bg-red-50 p-1.5">
                              <p className="mb-1 text-xs font-semibold text-red-700">便未指定（{orphanStops.length}件）</p>
                              <ul className="space-y-1">
                                {orphanStops.map(s => renderAssignedStopRow(s, ''))}
                              </ul>
                            </div>
                          ) : null;
                        })()}
                      </div>
                      );
                    })
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            {started && (
              <button
                onClick={() => handleOptimize(false)}
                disabled={
                  !editable ||
                  busy ||
                  checkingAssignment ||
                  !!assignmentWarning ||
                  !assignments[0].truckId ||
                  !assignments[0].driverId ||
                  (!hasPendingPoolChanges && !hasDriverChange)
                }
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? '保存中...' : '変更を保存する'}
              </button>
            )}
            <button
              onClick={handleReturnToList}
              disabled={!editable || busy}
              className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-blue-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {started ? '配送計画一覧へ戻る' : '配送計画一覧へ'}
            </button>
          </div>
        </div>

      <div className="space-y-2">
        {!started && (
          <p className="text-xs text-gray-500">
            ここまでの内容は既に保存されています。トラックが出発する前であれば引き続き配送先・荷物の追加割当が可能です。ドライバー用URLは配送計画一覧の各行からいつでもコピーできます。
          </p>
        )}
      </div>
    </div>
  );
}
