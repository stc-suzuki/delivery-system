'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { format } from 'date-fns';
import { RouteStatus } from '@prisma/client';

const TrackingMap = dynamic(() => import('@/components/map/TrackingMap'), { ssr: false });

type Stop = { id: string; stopOrder: number; status: string; location: { name: string; lat: number; lng: number } };
type Route = {
  id: string;
  status: RouteStatus;
  truck: { plateNo: string };
  driver: { name: string };
  stops: Stop[];
};
type Plan = { id: string; planDate: string; status: string; routes: Route[] };

const ROUTE_STATUS_LABELS: Record<RouteStatus, string> = {
  PENDING: '未開始',
  IN_PROGRESS: '進行中',
  COMPLETED: '完了',
};

export default function TrackingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  async function fetchPlans() {
    const date = format(new Date(), 'yyyy-MM-dd');
    const res = await fetch(`/api/plans?date=${date}`);
    setPlans(await res.json());
  }

  useEffect(() => {
    fetchPlans();
    const interval = setInterval(fetchPlans, 15000);
    return () => clearInterval(interval);
  }, []);

  const allRoutes = plans.flatMap(p => p.routes);
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
    <div className="flex h-[calc(100vh-3rem)] gap-3">
      <aside className="w-72 shrink-0 space-y-2 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700">本日のルート</h2>
        {allRoutes.length === 0 && <p className="text-sm text-gray-500">ルートがありません</p>}
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
              <span className="text-xs text-gray-500">{ROUTE_STATUS_LABELS[route.status]}</span>
            </div>
            <p className="text-xs text-gray-500">{route.driver.name}</p>
            <p className="text-xs text-gray-400">
              {route.stops.filter(s => s.status === 'COMPLETED').length} / {route.stops.length} 完了
            </p>
          </button>
        ))}

        {selectedRoute && (
          <div className="mt-3 border-t border-gray-200 pt-3">
            <h3 className="mb-2 text-sm font-semibold text-gray-700">停車地一覧</h3>
            <ul className="space-y-1">
              {selectedRoute.stops
                .slice()
                .sort((a, b) => a.stopOrder - b.stopOrder)
                .map(stop => (
                  <li key={stop.id} className="flex items-center justify-between text-xs">
                    <span className="truncate">{stop.location.name}</span>
                    <span
                      className={
                        stop.status === 'COMPLETED'
                          ? 'text-green-600'
                          : stop.status === 'SKIPPED'
                          ? 'text-gray-400'
                          : 'text-yellow-600'
                      }
                    >
                      {stop.status === 'COMPLETED' ? '完了' : stop.status === 'SKIPPED' ? 'スキップ' : '未訪問'}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </aside>
      <div className="flex-1 overflow-hidden rounded-lg border border-gray-200">
        <TrackingMap routes={mapRoutes} onTruckClick={setSelectedRouteId} />
      </div>
    </div>
  );
}
