'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { format } from 'date-fns';
import { MapPin } from 'lucide-react';
import { RouteStatus } from '@prisma/client';
import PageHeader from '@/components/ui/PageHeader';

const TrackingMap = dynamic(() => import('@/components/map/TrackingMap'), { ssr: false });

// 停車地の状態訂正・運送開始/帰社の代理操作は配送管理者以上のみ。一般ユーザー（STAFF）は
// 参照専用（/plansのガントチャートと同じ方針。middleware.tsのROLE_RANK参照）
const ROLE_RANK: Record<string, number> = { STAFF: 0, DELIVERY_ADMIN: 1, SYSTEM_ADMIN: 2 };

type Stop = {
  id: string;
  stopOrder: number;
  status: string;
  statusSetByDispatcher: boolean;
  location: { name: string; lat: number; lng: number };
};
type Route = {
  id: string;
  status: RouteStatus;
  returnedAt: string | null;
  startedByDispatcher: boolean;
  returnedByDispatcher: boolean;
  truck: { plateNo: string };
  driver: { name: string };
  stops: Stop[];
};
const ROUTE_STATUS_LABELS: Record<RouteStatus, string> = {
  PENDING: '未開始',
  IN_PROGRESS: '進行中',
  COMPLETED: '完了',
};
const STOP_STATUS_OPTIONS = [
  { value: 'PENDING', label: '未訪問' },
  { value: 'COMPLETED', label: '完了' },
  { value: 'SKIPPED', label: 'スキップ' },
];

export default function TrackingPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? 'STAFF';
  const canOperate = (ROLE_RANK[role] ?? 0) >= 1;
  const [allRoutes, setAllRoutes] = useState<Route[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [depotCenter, setDepotCenter] = useState<{ lat: number; lng: number } | undefined>(undefined);

  async function fetchRoutes() {
    const date = format(new Date(), 'yyyy-MM-dd');
    const res = await fetch(`/api/plans?date=${date}`);
    setAllRoutes(await res.json());
  }

  useEffect(() => {
    fetchRoutes();
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => setDepotCenter({ lat: data.depotLat, lng: data.depotLng }));
    const interval = setInterval(fetchRoutes, 15000);
    return () => clearInterval(interval);
  }, []);

  // ドライバーが押し忘れた場合に本部側から代理で訂正する操作。actor: 'DISPATCHER' を付けて送ることで、
  // ドライバー画面に「本部による操作」と表示される（statusSetByDispatcher / startedByDispatcher / returnedByDispatcher）
  async function updateStopStatus(stopId: string, status: string) {
    setBusy(true);
    try {
      await fetch(`/api/tracking/stops/${stopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, actor: 'DISPATCHER' }),
      });
      await fetchRoutes();
    } finally {
      setBusy(false);
    }
  }

  async function startRouteAsDispatcher(routeId: string) {
    setBusy(true);
    try {
      await fetch(`/api/driver/${routeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'IN_PROGRESS', actor: 'DISPATCHER' }),
      });
      await fetchRoutes();
    } finally {
      setBusy(false);
    }
  }

  async function markReturnedAsDispatcher(routeId: string, returned: boolean) {
    setBusy(true);
    try {
      await fetch(`/api/driver/${routeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markReturned: returned, actor: 'DISPATCHER' }),
      });
      await fetchRoutes();
    } finally {
      setBusy(false);
    }
  }

  const mapRoutes = allRoutes.map(r => ({
    id: r.id,
    truckPlate: r.truck.plateNo,
    driverName: r.driver.name,
    stops: r.stops.map(s => ({
      lat: s.location.lat,
      lng: s.location.lng,
      order: s.stopOrder,
      name: s.location.name,
      status: s.status,
    })),
  }));

  const selectedRoute = allRoutes.find(r => r.id === selectedRouteId);

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-3">
      <PageHeader
        icon={MapPin}
        title="リアルタイム追跡"
        description="本日稼働中のトラックの位置と停車地の進捗を確認できます。"
        tint="blue"
        showDeliveryAdminBadge={canOperate}
      />
      <div className="flex flex-1 gap-3 overflow-hidden">
      <aside className="w-72 shrink-0 space-y-2 overflow-y-auto rounded-lg border border-panel-line bg-panel p-3 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700">本日のルート</h2>
        {allRoutes.length === 0 && <p className="text-sm text-[#4B5563]">ルートがありません</p>}
        {allRoutes.map(route => (
          <button
            key={route.id}
            onClick={() => setSelectedRouteId(route.id)}
            className={`block w-full rounded border p-2 text-left text-sm ${
              selectedRouteId === route.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{route.truck.plateNo}</span>
              <span className="text-xs text-[#4B5563]">{ROUTE_STATUS_LABELS[route.status]}</span>
            </div>
            <p className="text-xs text-[#4B5563]">{route.driver.name}</p>
            <p className="text-xs text-[#4B5563]">
              {route.stops.filter(s => s.status === 'COMPLETED').length} / {route.stops.length} 完了
            </p>
          </button>
        ))}

        {selectedRoute && (
          <div className="mt-3 border-t border-gray-200 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">停車地一覧</h3>
              {selectedRoute.status === 'PENDING' && canOperate && (
                <button
                  onClick={() => startRouteAsDispatcher(selectedRoute.id)}
                  disabled={busy}
                  className="rounded bg-orange-100 px-2 py-1 text-xs font-medium text-orange-700 disabled:opacity-50"
                >
                  運送開始（代理）
                </button>
              )}
            </div>
            {selectedRoute.startedByDispatcher && (
              <p className="mb-2 text-xs text-orange-600">運送開始は本部が代理操作しました</p>
            )}
            <ul className="space-y-1">
              {selectedRoute.stops
                .slice()
                .sort((a, b) => a.stopOrder - b.stopOrder)
                .map(stop => (
                  <li key={stop.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex-1 truncate">
                      {stop.location.name}
                      {stop.statusSetByDispatcher && stop.status !== 'PENDING' && (
                        <span className="ml-1 text-[10px] text-[#4B5563]">（本部操作）</span>
                      )}
                    </span>
                    {canOperate ? (
                      <select
                        value={stop.status}
                        disabled={busy}
                        onChange={e => updateStopStatus(stop.id, e.target.value)}
                        className={`shrink-0 rounded border border-gray-300 px-1 py-0.5 text-xs ${
                          stop.status === 'COMPLETED'
                            ? 'text-green-600'
                            : stop.status === 'SKIPPED'
                            ? 'text-[#4B5563]'
                            : 'text-yellow-600'
                        }`}
                      >
                        {STOP_STATUS_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={`shrink-0 text-xs ${
                          stop.status === 'COMPLETED'
                            ? 'text-green-600'
                            : stop.status === 'SKIPPED'
                            ? 'text-[#4B5563]'
                            : 'text-yellow-600'
                        }`}
                      >
                        {STOP_STATUS_OPTIONS.find(o => o.value === stop.status)?.label ?? stop.status}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
            {selectedRoute.status === 'COMPLETED' && !selectedRoute.returnedAt && canOperate && (
              <button
                onClick={() => markReturnedAsDispatcher(selectedRoute.id, true)}
                disabled={busy}
                className="mt-2 rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-700 disabled:opacity-50"
              >
                帰社（代理）
              </button>
            )}
            {selectedRoute.returnedAt && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs">
                  {format(new Date(selectedRoute.returnedAt), 'HH:mm')} 帰社済み
                </span>
                {canOperate && (
                  <button
                    onClick={() => markReturnedAsDispatcher(selectedRoute.id, false)}
                    disabled={busy}
                    className="text-xs text-[#4B5563] hover:underline disabled:opacity-50"
                  >
                    未帰社に戻す
                  </button>
                )}
              </div>
            )}
            {selectedRoute.returnedByDispatcher && (
              <p className="mt-1 text-xs text-green-600">帰社は本部が代理操作しました</p>
            )}
          </div>
        )}
      </aside>
      <div className="flex-1 overflow-hidden rounded-lg border border-gray-200">
        <TrackingMap routes={mapRoutes} selectedRouteId={selectedRouteId} onTruckClick={setSelectedRouteId} depotCenter={depotCenter} />
      </div>
      </div>
    </div>
  );
}
