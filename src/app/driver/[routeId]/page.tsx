'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { format } from 'date-fns';
import PlanStatusBadge from '@/components/plans/PlanStatusBadge';
import FuelIcon from '@/components/icons/FuelIcon';
import { PlanStatus, RouteStatus, StopStatus } from '@prisma/client';

type Stop = {
  id: string;
  stopOrder: number;
  status: StopStatus;
  scheduledTime: string | null;
  isTimeFixed: boolean;
  note: string | null;
  location: { id: string; name: string; address: string; phone: string | null; lat: number; lng: number };
};

type FuelLog = {
  id: string;
  timestamp: string;
};

type RouteDetail = {
  id: string;
  status: RouteStatus;
  truck: { plateNo: string };
  driver: { name: string };
  plan: { planDate: string; status: PlanStatus };
  stops: Stop[];
  fuelLogs: FuelLog[];
};

const STOP_LABELS: Record<StopStatus, string> = {
  PENDING: '未訪問',
  COMPLETED: '完了',
  SKIPPED: 'スキップ',
};

export default function DriverRoutePage() {
  const params = useParams();
  const routeId = params.routeId as string;

  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [updatingStopId, setUpdatingStopId] = useState<string | null>(null);
  const [startingRoute, setStartingRoute] = useState(false);
  const [recordingFuel, setRecordingFuel] = useState(false);
  const [cancelingFuelId, setCancelingFuelId] = useState<string | null>(null);
  const [showUpdatedBanner, setShowUpdatedBanner] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const prevStopsFingerprintRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function handleDeleted() {
    setDeleted(true);
    stopTracking();
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }

  async function fetchRoute() {
    try {
      const res = await fetch(`/api/driver/${routeId}`);
      if (res.status === 404) {
        handleDeleted();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // 停車地の構成（件数・順序・予定時刻）が変わったら「運送開始」「完了/スキップ」操作以外での更新とみなす
      const fingerprint = (data.stops as Stop[])
        .slice()
        .sort((a, b) => a.stopOrder - b.stopOrder)
        .map(s => `${s.id}:${s.stopOrder}:${s.scheduledTime ?? ''}`)
        .join('|');
      if (prevStopsFingerprintRef.current !== null && prevStopsFingerprintRef.current !== fingerprint) {
        setShowUpdatedBanner(true);
        if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
      }
      prevStopsFingerprintRef.current = fingerprint;
      setRoute(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '取得に失敗しました');
    }
  }

  useEffect(() => {
    fetchRoute();
    pollIntervalRef.current = setInterval(fetchRoute, 30000);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  function startTracking() {
    if (!('geolocation' in navigator)) {
      setError('この端末では位置情報が利用できません');
      return;
    }
    setTracking(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        fetch('/api/tracking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            routeId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          }),
        }).then(fetchRoute);
      },
      () => setError('位置情報の取得に失敗しました'),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
  }

  function stopTracking() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setTracking(false);
  }

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  async function startRoute() {
    setStartingRoute(true);
    try {
      const res = await fetch(`/api/driver/${routeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'IN_PROGRESS' }),
      });
      if (res.status === 404) {
        handleDeleted();
        return;
      }
      if (!res.ok) throw new Error((await res.json()).error);
      await fetchRoute();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新に失敗しました');
    } finally {
      setStartingRoute(false);
    }
  }

  async function updateStopStatus(stopId: string, status: StopStatus) {
    setUpdatingStopId(stopId);
    try {
      const res = await fetch(`/api/tracking/stops/${stopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.status === 404) {
        handleDeleted();
        return;
      }
      if (!res.ok) throw new Error((await res.json()).error);
      await fetchRoute();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新に失敗しました');
    } finally {
      setUpdatingStopId(null);
    }
  }

  async function recordFuel() {
    setRecordingFuel(true);
    try {
      const res = await fetch('/api/tracking/fuel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeId }),
      });
      if (res.status === 404) {
        handleDeleted();
        return;
      }
      if (!res.ok) throw new Error((await res.json()).error);
      await fetchRoute();
    } catch (err) {
      setError(err instanceof Error ? err.message : '給油記録の追加に失敗しました');
    } finally {
      setRecordingFuel(false);
    }
  }

  async function cancelFuel(id: string) {
    setCancelingFuelId(id);
    try {
      const res = await fetch(`/api/tracking/fuel/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error);
      await fetchRoute();
    } catch (err) {
      setError(err instanceof Error ? err.message : '給油記録の取り消しに失敗しました');
    } finally {
      setCancelingFuelId(null);
    }
  }

  if (deleted) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-sm rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-lg font-bold text-red-700">この配送ルートは削除されました</p>
          <p className="mt-2 text-sm text-red-600">配送を中止し、担当者にご確認ください。</p>
        </div>
      </div>
    );
  }
  if (error && !route) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!route) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  const completedCount = route.stops.filter(s => s.status !== 'PENDING').length;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="sticky top-0 z-20">
        {showUpdatedBanner && (
          <div className="flex animate-pulse items-center justify-between gap-2 border-b-4 border-red-800 bg-red-600 px-4 py-3 text-sm font-bold text-white shadow-lg">
            <span className="flex items-center gap-2">
              <span aria-hidden className="text-lg">⚠️</span>
              ルートが更新されました！内容をご確認ください
            </span>
            <button
              onClick={() => setShowUpdatedBanner(false)}
              className="shrink-0 rounded bg-white px-3 py-1 text-xs font-bold text-red-700"
            >
              確認
            </button>
          </div>
        )}
        <header className="border-b border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-800">{route.truck.plateNo}</h1>
            <PlanStatusBadge status={route.plan.status} />
          </div>
          <p className="text-sm text-gray-500">
            {format(new Date(route.plan.planDate), 'yyyy/MM/dd')} ・ {route.driver.name}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            進捗 {completedCount} / {route.stops.length}
          </p>
          <div className="mt-2 h-2 w-full rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-blue-600 transition-all"
              style={{ width: `${route.stops.length ? (completedCount / route.stops.length) * 100 : 0}%` }}
            />
          </div>
        </header>
      </div>

      {error && <p className="m-3 rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      <main className="space-y-3 p-3">
        {route.status === 'PENDING' && (
          <button
            onClick={startRoute}
            disabled={startingRoute}
            className="w-full rounded bg-orange-500 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {startingRoute ? '更新中...' : '運送開始'}
          </button>
        )}

        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">給油記録</p>
            <button
              onClick={recordFuel}
              disabled={recordingFuel}
              aria-label="給油した"
              title="給油した"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xl text-white disabled:opacity-50"
            >
              {recordingFuel ? <span className="text-xs">…</span> : <FuelIcon className="h-5 w-5" />}
            </button>
          </div>
          {route.fuelLogs.length > 0 && (
            <ul className="mt-2 space-y-1">
              {route.fuelLogs.map(log => (
                <li key={log.id} className="flex items-center justify-between text-sm text-gray-600">
                  <span>{format(new Date(log.timestamp), 'HH:mm')}に給油しました</span>
                  <button
                    onClick={() => cancelFuel(log.id)}
                    disabled={cancelingFuelId === log.id}
                    className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 disabled:opacity-40"
                  >
                    取消
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {route.stops.map((stop, i) => (
          <div key={stop.id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium text-gray-800">{stop.location.name}</p>
                  {stop.scheduledTime && (
                    <p className="mt-0.5">
                      {stop.isTimeFixed ? (
                        <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-600">
                          {format(new Date(stop.scheduledTime), 'HH:mm')} 指定時刻
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                          {format(new Date(stop.scheduledTime), 'HH:mm')} 頃（目安）
                        </span>
                      )}
                    </p>
                  )}
                  <p className="text-xs text-gray-500">{stop.location.address}</p>
                  {stop.location.phone && (
                    <a href={`tel:${stop.location.phone}`} className="text-xs text-blue-600">
                      {stop.location.phone}
                    </a>
                  )}
                </div>
              </div>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${stop.location.lat},${stop.location.lng}&travelmode=driving`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700"
              >
                MAP
              </a>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  stop.status === 'COMPLETED'
                    ? 'bg-green-100 text-green-700'
                    : stop.status === 'SKIPPED'
                    ? 'bg-gray-100 text-gray-500'
                    : 'bg-yellow-100 text-yellow-700'
                }`}
              >
                {STOP_LABELS[stop.status]}
              </span>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => updateStopStatus(stop.id, 'COMPLETED')}
                disabled={updatingStopId === stop.id || stop.status === 'COMPLETED'}
                className="flex-1 rounded bg-green-600 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                完了
              </button>
              <button
                onClick={() => updateStopStatus(stop.id, 'SKIPPED')}
                disabled={updatingStopId === stop.id || stop.status === 'SKIPPED'}
                className="flex-1 rounded bg-gray-400 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                スキップ
              </button>
              {stop.status !== 'PENDING' && (
                <button
                  onClick={() => updateStopStatus(stop.id, 'PENDING')}
                  disabled={updatingStopId === stop.id}
                  className="rounded bg-gray-100 px-3 py-2 text-sm font-medium text-gray-600 disabled:opacity-40"
                >
                  取消
                </button>
              )}
            </div>
          </div>
        ))}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white p-3 space-y-2">
        {!tracking ? (
          <button onClick={startTracking} className="w-full rounded bg-blue-600 py-3 text-sm font-bold text-white">
            位置情報の共有を開始
          </button>
        ) : (
          <button onClick={stopTracking} className="w-full rounded bg-red-600 py-3 text-sm font-bold text-white">
            位置情報の共有を停止
          </button>
        )}
      </footer>
    </div>
  );
}
