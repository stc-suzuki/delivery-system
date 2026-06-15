'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { format, addDays } from 'date-fns';
import PlanStatusBadge from '@/components/plans/PlanStatusBadge';
import RouteCard, { RouteData, RouteStop } from '@/components/plans/RouteCard';
import type { RouteForMap } from '@/components/map/DeliveryMap';
import { getEditWarning } from '@/lib/planEditPolicy';
import type { DeliveryPlan } from '@prisma/client';

const DeliveryMap = dynamic(() => import('@/components/map/DeliveryMap'), { ssr: false });

const ROUTE_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5',
  '#0d9488', '#c026d3', '#ca8a04', '#059669', '#be123c',
];

type Location = { id: string; name: string; address: string; lat: number; lng: number };
type Truck = { id: string; plateNo: string; status: string };
type Driver = { id: string; name: string; type: 'REGULAR' | 'SPOT' };

type ApiStop = { id: string; locationId: string; stopOrder: number; status: string; location: Location };
type ApiRoute = {
  id: string;
  truckId: string;
  driverId: string;
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

  // Step1
  const [planDate, setPlanDate] = useState('');
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set());
  const [locSearch, setLocSearch] = useState('');

  // Step2
  const [assignments, setAssignments] = useState<{ truckId: string; driverId: string }[]>([
    { truckId: '', driverId: '' },
  ]);
  const [routes, setRoutes] = useState<RouteData[]>([]);

  async function fetchAll() {
    const [planRes, locRes, truckRes, driverRes] = await Promise.all([
      fetch(`/api/plans/${planId}`),
      fetch('/api/locations'),
      fetch('/api/trucks'),
      fetch('/api/drivers'),
    ]);
    const planData: ApiPlan = await planRes.json();
    setPlan(planData);
    setPlanDate(format(new Date(planData.planDate), 'yyyy-MM-dd'));
    setLocations(await locRes.json());
    setTrucks(await truckRes.json());
    setDrivers(await driverRes.json());

    if (planData.routes.length > 0) {
      const ids = new Set<string>();
      planData.routes.forEach(r => r.stops.forEach(s => ids.add(s.locationId)));
      setSelectedLocationIds(ids);
      setAssignments(planData.routes.map(r => ({ truckId: r.truckId, driverId: r.driverId })));
      setRoutes(routesFromApi(planData.routes));
      setStep(2);
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
        })),
    }));
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

  const previewRoutes: RouteForMap[] = routes.map(r => ({
    id: r.id,
    color: r.color,
    stops: r.stops.map(s => ({ lat: s.lat, lng: s.lng, order: s.stopOrder, name: s.name })),
  }));

  function toggleLocation(id: string) {
    setSelectedLocationIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  async function handleSavePlanDate() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPlan(prev => (prev ? { ...prev, planDate: data.planDate } : prev));
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  function updateAssignment(index: number, field: 'truckId' | 'driverId', value: string) {
    setAssignments(prev => prev.map((a, i) => (i === index ? { ...a, [field]: value } : a)));
  }

  function addAssignmentRow() {
    if (assignments.length >= 15) return;
    setAssignments(prev => [...prev, { truckId: '', driverId: '' }]);
  }

  function removeAssignmentRow(index: number) {
    setAssignments(prev => prev.filter((_, i) => i !== index));
  }

  async function handleOptimize(force = false) {
    setBusy(true);
    setError('');
    try {
      const valid = assignments.filter(a => a.truckId && a.driverId);
      if (valid.length === 0) {
        throw new Error('トラックとドライバーを1組以上設定してください');
      }
      const res = await fetch(`/api/plans/${planId}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationIds: Array.from(selectedLocationIds),
          truckIds: valid.map(a => a.truckId),
          driverIds: valid.map(a => a.driverId),
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
    } catch (err) {
      setError(err instanceof Error ? err.message : '最適化に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  function handleReorder(routeId: string, stops: RouteStop[]) {
    setRoutes(prev => prev.map(r => (r.id === routeId ? { ...r, stops } : r)));
  }

  async function handleSaveRoutes() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/plans/${planId}/routes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routes: routes.map(r => ({
            id: r.id,
            stops: r.stops.map(s => ({ id: s.id, locationId: s.locationId, stopOrder: s.stopOrder })),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRoutes(routesFromApi(data.routes));
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
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
        <PlanStatusBadge status={plan.status} />
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

      {/* ステップナビ */}
      <div className="flex gap-2 text-sm">
        {[1, 2, 3].map(s => (
          <button
            key={s}
            onClick={() => setStep(s)}
            className={`rounded px-3 py-1 font-medium ${step === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            Step {s}
          </button>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
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
              <div className="max-h-80 space-y-1 overflow-y-auto">
                {filteredLocations.map(loc => (
                  <label key={loc.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedLocationIds.has(loc.id)}
                      disabled={!editable}
                      onChange={() => toggleLocation(loc.id)}
                    />
                    <span className="truncate">{loc.name}</span>
                  </label>
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

          <button
            onClick={handleSavePlanDate}
            disabled={!editable || busy || selectedLocationIds.size === 0}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            次へ（ルート最適化）
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">トラック・ドライバー割り当て（最大15）</h2>
            <div className="space-y-2">
              {assignments.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={a.truckId}
                    disabled={!editable}
                    onChange={e => updateAssignment(i, 'truckId', e.target.value)}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  >
                    <option value="">トラックを選択</option>
                    {trucks.map(t => (
                      <option key={t.id} value={t.id}>{t.plateNo}</option>
                    ))}
                  </select>
                  <select
                    value={a.driverId}
                    disabled={!editable}
                    onChange={e => updateAssignment(i, 'driverId', e.target.value)}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  >
                    <option value="">ドライバーを選択</option>
                    {drivers.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.name}（{d.type === 'REGULAR' ? '専任' : 'スポット'}）
                      </option>
                    ))}
                  </select>
                  {assignments.length > 1 && (
                    <button onClick={() => removeAssignmentRow(i)} className="text-xs text-red-500">削除</button>
                  )}
                </div>
              ))}
            </div>
            {assignments.length < 15 && (
              <button onClick={addAssignmentRow} className="mt-2 text-sm text-blue-600 hover:underline">
                + 行を追加
              </button>
            )}
          </div>

          <button
            onClick={() => handleOptimize(false)}
            disabled={!editable || busy}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? '最適化中...' : '自動最適化'}
          </button>

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

          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="rounded bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200">
              戻る
            </button>
            <button
              onClick={handleSaveRoutes}
              disabled={!editable || busy || routes.length === 0}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              次へ（確認）
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
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

          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="rounded bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200">
              戻る
            </button>
            <button
              onClick={() => handleSetStatus('DRAFT')}
              disabled={!editable || busy}
              className="rounded bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              DRAFT保存
            </button>
            <button
              onClick={() => handleSetStatus('CONFIRMED')}
              disabled={!editable || busy}
              className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              CONFIRMED確定
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
