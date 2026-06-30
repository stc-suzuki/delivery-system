'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { format, addDays } from 'date-fns';
import PlanStatusBadge from '@/components/plans/PlanStatusBadge';
import RouteCard, { RouteData, RouteStop } from '@/components/plans/RouteCard';
import type { RouteForMap } from '@/components/map/DeliveryMap';
import DispatchGanttChart, { GanttRoute } from '@/components/plans/DispatchGanttChart';
import { getEditWarning } from '@/lib/planEditPolicy';
import { DRIVER_TYPE_LABELS } from '@/lib/driverSchedule';
import { estimateStopTimes, TOCHIGI_DEPOT, LunchBreak } from '@/lib/routeOptimizer';
import type { DeliveryPlan, DriverType } from '@prisma/client';

const DeliveryMap = dynamic(() => import('@/components/map/DeliveryMap'), { ssr: false });

const ROUTE_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5',
  '#0d9488', '#c026d3', '#ca8a04', '#059669', '#be123c',
];

type Location = { id: string; name: string; address: string; lat: number; lng: number };
type Truck = { id: string; plateNo: string; status: string };
type Driver = { id: string; name: string; type: DriverType };

type ApiStop = {
  id: string;
  locationId: string;
  stopOrder: number;
  status: string;
  scheduledTime: string | null;
  isTimeFixed: boolean;
  location: Location;
};
type ApiRoute = {
  id: string;
  truckId: string;
  driverId: string;
  departureTime: string | null;
  truck: Truck;
  driver: Driver;
  stops: ApiStop[];
};
type ApiPlan = {
  id: string;
  planDate: string;
  status: 'DRAFT' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED';
  note: string | null;
  routes: ApiRoute[];
};

export default function PlanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const planId = params.id as string;

  const [plan, setPlan] = useState<ApiPlan | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 稼働中の計画への配送先追加
  const [addStopRouteId, setAddStopRouteId] = useState('');
  const [addStopLocationIds, setAddStopLocationIds] = useState<Set<string>>(new Set());
  const [addStopSearch, setAddStopSearch] = useState('');

  // Step1
  const [planDate, setPlanDate] = useState('');
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set());
  const [locSearch, setLocSearch] = useState('');
  const [arrivalTimes, setArrivalTimes] = useState<Record<string, string>>({});
  const [departureTime, setDepartureTime] = useState('');
  const [settings, setSettings] = useState<{
    defaultDepartureTime: string;
    lunchBreakStart: string;
    lunchBreakEnd: string;
    defaultStopDurationMinutes: number;
  } | null>(null);

  // Step2
  const [assignments, setAssignments] = useState<{ truckId: string; driverId: string }[]>([
    { truckId: '', driverId: '' },
  ]);
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [assignmentWarning, setAssignmentWarning] = useState('');
  const [checkingAssignment, setCheckingAssignment] = useState(false);
  const [showManualAdjust, setShowManualAdjust] = useState(false);

  async function fetchAll() {
    const [planRes, locRes, truckRes, driverRes, settingsRes] = await Promise.all([
      fetch(`/api/plans/${planId}`),
      fetch('/api/locations'),
      fetch('/api/trucks'),
      fetch('/api/drivers'),
      fetch('/api/settings'),
    ]);
    const planData: ApiPlan = await planRes.json();
    setPlan(planData);
    setPlanDate(format(new Date(planData.planDate), 'yyyy-MM-dd'));
    setLocations(await locRes.json());
    setTrucks(await truckRes.json());
    setDrivers(await driverRes.json());
    const settingsData = await settingsRes.json();
    setSettings(settingsData);

    if (planData.routes.length > 0) {
      const ids = new Set<string>();
      const times: Record<string, string> = {};
      planData.routes.forEach(r =>
        r.stops.forEach(s => {
          ids.add(s.locationId);
          if (s.scheduledTime && s.isTimeFixed) times[s.locationId] = format(new Date(s.scheduledTime), 'HH:mm');
        })
      );
      setSelectedLocationIds(ids);
      setArrivalTimes(times);
      if (planData.routes.length > 0) {
        const r = planData.routes[0];
        setAssignments([{ truckId: r.truckId, driverId: r.driverId }]);
        setDepartureTime(r.departureTime ? format(new Date(r.departureTime), 'HH:mm') : settingsData.defaultDepartureTime);
      }
      setRoutes(routesFromApi(planData.routes));
      setStep(1);
    } else {
      setDepartureTime(settingsData.defaultDepartureTime);
    }
  }

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  function routesFromApi(apiRoutes: ApiRoute[]): RouteData[] {
    return apiRoutes.map((r, i) => ({
      id: r.id,
      truckPlateNo: r.truck.plateNo,
      driverName: r.driver.name,
      color: ROUTE_COLORS[i % ROUTE_COLORS.length],
      departureTime: r.departureTime,
      stops: r.stops
        .slice()
        .sort((a, b) => a.stopOrder - b.stopOrder)
        .map(s => ({
          id: s.id,
          locationId: s.locationId,
          name: s.location.name,
          lat: s.location.lat,
          lng: s.location.lng,
          stopOrder: s.stopOrder,
          scheduledTime: s.scheduledTime,
          isTimeFixed: s.isTimeFixed,
        })),
    }));
  }

  function timeToIso(time: string): string | null {
    if (!time) return null;
    return new Date(`${planDate}T${time}:00`).toISOString();
  }

  function isoToTime(iso: string | null): string {
    if (!iso) return '';
    return format(new Date(iso), 'HH:mm');
  }

  if (!plan) return <p className="text-gray-500">読み込み中...</p>;

  const editWarning = getEditWarning({
    id: plan.id,
    planDate: new Date(plan.planDate),
    status: plan.status,
    note: plan.note,
    createdBy: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as DeliveryPlan);
  const editable = editWarning !== 'locked';

  const minDate = format(new Date(), 'yyyy-MM-dd');
  const maxDate = format(addDays(new Date(), 2), 'yyyy-MM-dd');

  const filteredLocations = locations.filter(
    l => l.name.includes(locSearch) || l.address.includes(locSearch)
  );

  const ganttRoutes: GanttRoute[] = routes.map(r => ({
    id: r.id,
    truckPlateNo: r.truckPlateNo,
    driverName: r.driverName,
    color: r.color,
    departureTime: r.departureTime,
    stops: r.stops.map(s => ({ id: s.id, name: s.name, scheduledTime: s.scheduledTime, isTimeFixed: s.isTimeFixed })),
  }));

  const previewRoutes: RouteForMap[] = routes.map(r => ({
    id: r.id,
    color: r.color,
    stops: r.stops.map(s => ({ lat: s.lat, lng: s.lng, order: s.stopOrder, name: s.name })),
  }));

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
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function updateArrivalTime(id: string, time: string) {
    setArrivalTimes(prev => {
      const next = { ...prev };
      if (time) next[id] = time;
      else delete next[id];
      return next;
    });
  }

  function handleMapClick(coord: { lat: number; lng: number }) {
    // 最も近い配送先を選択トグル
    let nearest: Location | null = null;
    let minDist = Infinity;
    for (const loc of locations) {
      const d = (loc.lat - coord.lat) ** 2 + (loc.lng - coord.lng) ** 2;
      if (d < minDist) {
        minDist = d;
        nearest = loc;
      }
    }
    if (nearest && minDist < 0.0005) toggleLocation(nearest.id);
  }

  async function saveAssignmentAndDate(): Promise<boolean> {
    const checkRes = await fetch(`/api/plans/${planId}/check-assignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ truckId: assignments[0].truckId, driverId: assignments[0].driverId }),
    });
    const checkData = await checkRes.json();
    if (!checkRes.ok) throw new Error(checkData.error);

    const res = await fetch(`/api/plans/${planId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planDate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setPlan(prev => (prev ? { ...prev, planDate: data.planDate } : prev));
    return true;
  }

  async function checkAssignment(truckId: string, driverId: string) {
    if (!truckId || !driverId) {
      setAssignmentWarning('');
      return;
    }
    setCheckingAssignment(true);
    try {
      const res = await fetch(`/api/plans/${planId}/check-assignment`, {
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

  async function handleOptimize(force = false) {
    setBusy(true);
    setError('');
    try {
      const valid = assignments.filter(a => a.truckId && a.driverId);
      if (valid.length === 0) {
        throw new Error('トラックとドライバーを1組以上設定してください');
      }
      const arrivalTimesIso = Object.fromEntries(
        Object.entries(arrivalTimes)
          .filter(([id, time]) => selectedLocationIds.has(id) && time)
          .map(([id, time]) => [id, timeToIso(time)])
      );
      const res = await fetch(`/api/plans/${planId}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationIds: Array.from(selectedLocationIds),
          truckIds: valid.map(a => a.truckId),
          driverIds: valid.map(a => a.driverId),
          arrivalTimes: arrivalTimesIso,
          departureTime: departureTime || undefined,
          force,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && !force) {
          if (confirm('既存のルートを再生成して上書きしますか？')) {
            return handleOptimize(true);
          }
          return;
        }
        throw new Error(data.error);
      }
      setRoutes(routesFromApi(data.plan.routes));
      if (data.warnings?.length > 0) {
        alert(`以下の到着希望時刻には間に合わない可能性があります:\n\n${data.warnings.join('\n')}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '最適化に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  // 手動並べ替え後、新しい順序に基づいて各停車地の到着予定時刻を再計算する
  function recomputeStopTimes(stops: RouteStop[]): RouteStop[] {
    if (!settings || !planDate || !departureTime) return stops;
    const depDate = new Date(`${planDate}T${departureTime}:00`);
    const lunchStart = new Date(`${planDate}T${settings.lunchBreakStart}:00`);
    const lunchEnd = new Date(`${planDate}T${settings.lunchBreakEnd}:00`);
    const lunchBreak: LunchBreak | undefined =
      lunchEnd.getTime() > lunchStart.getTime() ? { start: lunchStart, end: lunchEnd } : undefined;

    const withArrival = stops.map(s => ({ ...s, arrivalTime: s.isTimeFixed ? s.scheduledTime : null }));
    const timed = estimateStopTimes(TOCHIGI_DEPOT, depDate, withArrival, lunchBreak, settings.defaultStopDurationMinutes);
    return timed.map(t => ({
      id: t.id,
      locationId: t.locationId,
      name: t.name,
      lat: t.lat,
      lng: t.lng,
      stopOrder: t.stopOrder,
      scheduledTime: t.estimatedTime.toISOString(),
      isTimeFixed: t.isTimeFixed,
    }));
  }

  function handleReorder(routeId: string, stops: RouteStop[]) {
    const recomputed = recomputeStopTimes(stops);
    setRoutes(prev => prev.map(r => (r.id === routeId ? { ...r, stops: recomputed } : r)));
  }

  async function handleProceedToConfirm() {
    setBusy(true);
    setError('');
    try {
      if (selectedLocationIds.size === 0 || !assignments[0].truckId || !assignments[0].driverId) {
        throw new Error('トラック・ドライバー・配送先を設定してください');
      }
      if (routes.length === 0) {
        throw new Error('先に自動最適化を実行してください');
      }
      await saveAssignmentAndDate();
      const res = await fetch(`/api/plans/${planId}/routes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routes: routes.map(r => ({
            id: r.id,
            stops: r.stops.map(s => ({
              id: s.id,
              locationId: s.locationId,
              stopOrder: s.stopOrder,
              scheduledTime: s.scheduledTime,
              isTimeFixed: s.isTimeFixed,
            })),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRoutes(routesFromApi(data.routes));
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  function toggleAddStopLocation(id: string) {
    setAddStopLocationIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAddStops() {
    if (!addStopRouteId || addStopLocationIds.size === 0) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/plans/${planId}/routes/${addStopRouteId}/add-stops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationIds: Array.from(addStopLocationIds) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPlan(data);
      setRoutes(routesFromApi(data.routes));
      setAddStopLocationIds(new Set());
      setAddStopSearch('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '配送先の追加に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm('この配送計画を削除しますか？この操作は取り消せません。')) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/plans/${planId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push('/plans');
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました');
      setBusy(false);
    }
  }

  async function handleSetStatus(status: 'DRAFT' | 'CONFIRMED') {
    if (status === 'CONFIRMED' && !confirm('この配送計画を確定しますか？確定後は当日まで一部編集が制限されます。')) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPlan(prev => (prev ? { ...prev, status: data.status } : prev));
      router.push('/plans');
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">配送計画 {format(new Date(plan.planDate), 'yyyy/MM/dd')}</h1>
        <div className="flex items-center gap-3">
          <PlanStatusBadge status={plan.status} />
          {plan.status === 'DRAFT' && (
            <button
              onClick={handleDelete}
              disabled={busy}
              className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              削除
            </button>
          )}
        </div>
      </div>

      {editWarning === 'same_day' && (
        <div className="rounded bg-yellow-50 p-3 text-sm text-yellow-800">
          本日分の計画を編集しています。配送中のルートに影響する可能性があるため注意してください。
        </div>
      )}
      {!editable && (
        <div className="rounded bg-gray-100 p-3 text-sm text-gray-600">
          この計画は編集できません（進行中・完了、または対象期間外）。
        </div>
      )}
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      {plan.status === 'IN_PROGRESS' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-gray-700">配送先の追加（稼働中の計画）</h2>
          <p className="mb-2 text-xs text-gray-500">
            配達済み・スキップ済みの停車地はそのまま、未配達分と追加分のみを現在地から再最適化します。
          </p>
          <div className="mb-2 flex items-center gap-2">
            <select
              value={addStopRouteId}
              onChange={e => setAddStopRouteId(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="">追加先のルートを選択</option>
              {plan.routes.map(r => (
                <option key={r.id} value={r.id}>
                  {r.truck.plateNo} / {r.driver.name}
                </option>
              ))}
            </select>
            <input
              placeholder="配送先検索"
              value={addStopSearch}
              onChange={e => setAddStopSearch(e.target.value)}
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="mb-2 max-h-48 space-y-1 overflow-y-auto rounded border border-gray-200 bg-white p-2">
            {locations
              .filter(l => l.name.includes(addStopSearch) || l.address.includes(addStopSearch))
              .map(loc => (
                <label key={loc.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={addStopLocationIds.has(loc.id)}
                    onChange={() => toggleAddStopLocation(loc.id)}
                  />
                  <span className="truncate">{loc.name}</span>
                </label>
              ))}
          </div>
          <button
            onClick={handleAddStops}
            disabled={busy || !addStopRouteId || addStopLocationIds.size === 0}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? '追加・再最適化中...' : `追加して再最適化（${addStopLocationIds.size}件）`}
          </button>
        </div>
      )}

      {/* ステップナビ */}
      <div className="flex gap-2 text-sm">
        {[
          { value: 1, label: 'Step 1: 計画・ルート編集' },
          { value: 2, label: 'Step 2: 確認・確定' },
        ].map(s => (
          <button
            key={s.value}
            onClick={() => setStep(s.value)}
            className={`rounded px-3 py-1 font-medium ${step === s.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div className="flex gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">対象日</label>
              <input
                type="date"
                value={planDate}
                min={minDate}
                max={maxDate}
                disabled={!editable}
                onChange={e => setPlanDate(e.target.value)}
                className="mt-1 rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">出発時間</label>
              <input
                type="time"
                value={departureTime}
                disabled={!editable}
                onChange={e => setDepartureTime(e.target.value)}
                className="mt-1 rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">トラック・ドライバー割り当て</h2>
            <div className="flex items-center gap-2">
              <select
                value={assignments[0].truckId}
                disabled={!editable}
                onChange={e => updateAssignment(0, 'truckId', e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="">トラックを選択</option>
                {trucks.map(t => (
                  <option key={t.id} value={t.id}>{t.plateNo}</option>
                ))}
              </select>
              <select
                value={assignments[0].driverId}
                disabled={!editable}
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
            {checkingAssignment && <p className="mt-2 text-xs text-gray-400">重複を確認中...</p>}
            {assignmentWarning && (
              <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-600">{assignmentWarning}</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700">配送先選択</h2>
                <span className="text-xs text-gray-500">選択済み: {selectedLocationIds.size}件</span>
              </div>
              <input
                placeholder="検索"
                value={locSearch}
                onChange={e => setLocSearch(e.target.value)}
                className="mb-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <p className="mb-2 text-xs text-gray-400">
                到着希望時刻を入力した配送先は最優先で順序付けされます。未入力の配送先はルート最適化により自動配置されます。
              </p>
              <div className="max-h-80 space-y-1 overflow-y-auto">
                {filteredLocations.map(loc => (
                  <div key={loc.id} className="flex items-center gap-2 text-sm">
                    <label className="flex flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedLocationIds.has(loc.id)}
                        disabled={!editable}
                        onChange={() => toggleLocation(loc.id)}
                      />
                      <span className="truncate">{loc.name}</span>
                    </label>
                    {selectedLocationIds.has(loc.id) && (
                      <input
                        type="time"
                        disabled={!editable}
                        value={arrivalTimes[loc.id] ?? ''}
                        onChange={e => updateArrivalTime(loc.id, e.target.value)}
                        className={`rounded border px-1 py-0.5 text-xs ${
                          arrivalTimes[loc.id] ? 'border-red-300 bg-red-50' : 'border-gray-300'
                        }`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="h-96 rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
              <DeliveryMap
                routes={[
                  {
                    id: 'selection',
                    color: '#2563eb',
                    stops: locations
                      .filter(l => selectedLocationIds.has(l.id))
                      .map((l, i) => ({ lat: l.lat, lng: l.lng, order: i, name: l.name })),
                  },
                ]}
                onLocationClick={editable ? handleMapClick : undefined}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => handleOptimize(false)}
              disabled={
                !editable ||
                busy ||
                checkingAssignment ||
                !!assignmentWarning ||
                selectedLocationIds.size === 0 ||
                !assignments[0].truckId ||
                !assignments[0].driverId
              }
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? '最適化中...' : '自動最適化'}
            </button>
            <button
              onClick={() => setShowManualAdjust(v => !v)}
              disabled={routes.length === 0}
              className="rounded bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
            >
              {showManualAdjust ? '手動調整を閉じる' : '手動調整'}
            </button>
          </div>

          {showManualAdjust && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                {routes.map(route => (
                  <RouteCard key={route.id} route={route} onReorder={handleReorder} />
                ))}
              </div>
              <div className="h-96 rounded-lg border border-gray-200 bg-white p-2 shadow-sm lg:h-auto">
                <DeliveryMap routes={previewRoutes} />
              </div>
            </div>
          )}

          <button
            onClick={handleProceedToConfirm}
            disabled={!editable || busy || checkingAssignment || !!assignmentWarning || routes.length === 0}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            次へ（確認）
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">トラック</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">ドライバー</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">停車件数</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">ドライバー用URL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {routes.map(r => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">{r.truckPlateNo}</td>
                    <td className="px-4 py-2">{r.driverName}</td>
                    <td className="px-4 py-2">{r.stops.length}</td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => {
                          const url = `${window.location.origin}/driver/${r.id}`;
                          navigator.clipboard.writeText(url);
                          alert(`コピーしました:\n${url}`);
                        }}
                        className="text-blue-600 hover:underline"
                      >
                        URLをコピー
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">時刻設定（出発・到着予定）</h2>
            <p className="mb-2 text-xs text-gray-400">この内容は参照のみです。変更する場合はSTEP1・STEP2に戻ってください。</p>
            <div className="space-y-4">
              {routes.map(r => (
                <div key={r.id} className="rounded border border-gray-100 p-2">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: r.color }} />
                    <span className="text-sm font-medium">{r.truckPlateNo} / {r.driverName}</span>
                    <span className="ml-auto text-xs text-gray-500">
                      出発 {isoToTime(r.departureTime) || '--:--'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {r.stops.map((s, i) => (
                      <span
                        key={s.id}
                        className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs text-gray-600 ${
                          s.isTimeFixed ? 'border-red-300 bg-red-50' : 'border-gray-200'
                        }`}
                      >
                        {i + 1}.{s.name} {isoToTime(s.scheduledTime) || '--:--'}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-700">配車表</h2>
            <DispatchGanttChart routes={ganttRoutes} />
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="rounded bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200">
                戻る
              </button>
              <button
                onClick={() => handleSetStatus('DRAFT')}
                disabled={!editable || busy}
                className="rounded bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                下書きとして保存
              </button>
              <button
                onClick={() => handleSetStatus('CONFIRMED')}
                disabled={!editable || busy}
                className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                計画を確定する
              </button>
            </div>
            <p className="text-xs text-gray-500">
              「下書きとして保存」: 未確定の状態で保存し、後で内容を変更できます。
              <br />
              「計画を確定する」: ドライバーへの配信を前提とした確定状態にします。確定後は当日まで一部の編集が制限されます。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
