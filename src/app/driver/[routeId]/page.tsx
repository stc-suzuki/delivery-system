'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { format } from 'date-fns';
import FuelIcon from '@/components/icons/FuelIcon';
import { RouteStatus, StopStatus } from '@prisma/client';
import {
  computeRouteOperationStatus,
  ROUTE_OPERATION_STATUS_LABELS,
  ROUTE_OPERATION_STATUS_STYLES,
} from '@/lib/routeOperationStatus';

type Stop = {
  id: string;
  stopOrder: number;
  status: StopStatus;
  scheduledTime: string | null;
  requestedArrivalTime: string | null;
  isTimeFixed: boolean;
  note: string | null;
  statusSetByDispatcher: boolean;
  // このルートの中でどの便（RouteTrip）の荷物か。null＝便を使わない今まで通りの単一ルート扱い
  tripId: string | null;
  location: { id: string; name: string; address: string; phone: string | null; lat: number; lng: number };
};

type FuelLog = {
  id: string;
  timestamp: string;
};

// 複数便対応フェーズ3：1つのルート（トラック1台分）の中の便。1件も無ければ今まで通りの単一連続ルート
type Trip = {
  id: string;
  tripIndex: number;
  status: RouteStatus;
  returnedAt: string | null;
  startedByDispatcher: boolean;
  returnedByDispatcher: boolean;
};

type RouteDetail = {
  id: string;
  status: RouteStatus;
  routeDate: string;
  returnedAt: string | null;
  startedByDispatcher: boolean;
  returnedByDispatcher: boolean;
  truck: { plateNo: string };
  driver: { name: string };
  stops: Stop[];
  fuelLogs: FuelLog[];
  trips: Trip[];
};

const STOP_LABELS: Record<StopStatus, string> = {
  PENDING: '未訪問',
  COMPLETED: '完了',
  SKIPPED: 'スキップ',
};

const TRIP_STATUS_LABELS: Record<RouteStatus, string> = {
  PENDING: '未開始',
  IN_PROGRESS: '進行中',
  COMPLETED: '完了',
};

// 便ごとの区切りを、状態色のヘッダーで箱として囲む（便まるごと色分けブロック案）。
// 小さいバッジだけだとスクロール中に見落としやすいため、便の切れ目そのものを箱の境界にした
const TRIP_BLOCK_STYLES: Record<RouteStatus, { border: string; head: string }> = {
  PENDING: { border: 'border-gray-200', head: 'bg-gray-100 text-gray-500' },
  IN_PROGRESS: { border: 'border-yellow-300', head: 'bg-yellow-100 text-yellow-800' },
  COMPLETED: { border: 'border-green-300', head: 'bg-green-100 text-green-800' },
};

export default function DriverRoutePage() {
  const params = useParams();
  const routeId = params.routeId as string;

  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState(false);
  // ドライバー用URLは配送日の当日しか使えない。日付が変わった・別の日のURLを開いた場合に立てる
  const [expired, setExpired] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [updatingStopId, setUpdatingStopId] = useState<string | null>(null);
  const [startingRoute, setStartingRoute] = useState(false);
  const [markingReturned, setMarkingReturned] = useState(false);
  const [tripActionId, setTripActionId] = useState<string | null>(null);
  const [recordingFuel, setRecordingFuel] = useState(false);
  const [cancelingFuelId, setCancelingFuelId] = useState<string | null>(null);
  const [showUpdatedBanner, setShowUpdatedBanner] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const prevStopsFingerprintRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // GPS送信・給油記録は位置情報コールバック内から呼ばれるため、setState経由のroute（クロージャに
  // 固定された古い値になりうる）ではなく、常に最新のrouteを参照できるようrefで持っておく
  const routeRef = useRef<RouteDetail | null>(null);
  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  // 今対応中（未完了）の便のIDを返す（ルートは常に便を1件以上持つ）
  function currentTripId(): string | null {
    const r = routeRef.current;
    if (!r) return null;
    const active = r.trips.find(t => t.status !== 'COMPLETED');
    return active ? active.id : null;
  }

  function handleDeleted() {
    setDeleted(true);
    stopUpdates();
  }

  function handleExpired() {
    setExpired(true);
    stopUpdates();
  }

  function stopUpdates() {
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
      if (res.status === 403 && data.expired) {
        handleExpired();
        return;
      }
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
            tripId: currentTripId(),
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

  async function markReturned() {
    setMarkingReturned(true);
    try {
      const res = await fetch(`/api/driver/${routeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markReturned: true }),
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
      setMarkingReturned(false);
    }
  }

  // 複数便対応フェーズ3：この便を完了して本社へ（最後の便以外に表示）
  async function completeTrip(tripId: string) {
    setTripActionId(tripId);
    try {
      const res = await fetch(`/api/driver/${routeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completeTripId: tripId }),
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
      setTripActionId(null);
    }
  }

  // 複数便対応フェーズ3：次の便を開始
  async function startTrip(tripId: string) {
    setTripActionId(tripId);
    try {
      const res = await fetch(`/api/driver/${routeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startTripId: tripId }),
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
      setTripActionId(null);
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
        body: JSON.stringify({ routeId, tripId: currentTripId() }),
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
  if (expired) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-sm rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="text-lg font-bold text-amber-800">このURLの有効期限が切れています</p>
          <p className="mt-2 text-sm text-amber-700">ドライバー用のURLは配送日の当日のみ利用できます。担当者に確認してください。</p>
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

  // 停車地1件分のカード。actionableがfalseの場合（＝便を使うルートで、その便がまだ進行中でない場合）は
  // 完了・スキップ・取消ボタンを無効化し、順番を飛ばして先の便を操作させない
  function renderStopCard(stop: Stop, index: number, actionable: boolean) {
    return (
      <div key={stop.id} className="rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] p-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
              {index + 1}
            </span>
            <div>
              <p className="font-medium text-gray-800">{stop.location.name}</p>
              {stop.isTimeFixed && stop.requestedArrivalTime ? (
                <p className="mt-0.5">
                  <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-600">
                    {format(new Date(stop.requestedArrivalTime), 'HH:mm')} 指定時刻
                  </span>
                </p>
              ) : (
                stop.scheduledTime && (
                  <p className="mt-0.5">
                    <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                      {format(new Date(stop.scheduledTime), 'HH:mm')} 頃（目安）
                    </span>
                  </p>
                )
              )}
              <p className="text-xs text-[#4B5563]">{stop.location.address}</p>
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
            {stop.statusSetByDispatcher && stop.status !== 'PENDING' && '（本部による押下）'}
          </span>
        </div>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => updateStopStatus(stop.id, 'COMPLETED')}
            disabled={!actionable || updatingStopId === stop.id || stop.status === 'COMPLETED'}
            className="flex-1 rounded bg-green-600 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            完了
          </button>
          <button
            onClick={() => updateStopStatus(stop.id, 'SKIPPED')}
            disabled={!actionable || updatingStopId === stop.id || stop.status === 'SKIPPED'}
            className="flex-1 rounded bg-gray-400 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            スキップ
          </button>
          {stop.status !== 'PENDING' && (
            <button
              onClick={() => updateStopStatus(stop.id, 'PENDING')}
              disabled={!actionable || updatingStopId === stop.id}
              className="rounded bg-gray-100 px-3 py-2 text-sm font-medium text-gray-600 disabled:opacity-40"
            >
              取消
            </button>
          )}
        </div>
      </div>
    );
  }

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
            {(() => {
              const operationStatus = computeRouteOperationStatus(
                route.status,
                route.stops.some(s => s.status === 'COMPLETED')
              );
              return (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROUTE_OPERATION_STATUS_STYLES[operationStatus]}`}
                >
                  {ROUTE_OPERATION_STATUS_LABELS[operationStatus]}
                </span>
              );
            })()}
          </div>
          <p className="text-sm text-gray-500">
            {format(new Date(route.routeDate), 'yyyy/MM/dd')} ・ {route.driver.name}
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
        {route.status !== 'PENDING' && route.startedByDispatcher && (
          <p className="rounded-lg border border-orange-200 bg-orange-50 py-2 text-center text-xs font-semibold text-orange-700">
            本部が運送開始の操作をしました
          </p>
        )}

        <div className="rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] p-3 shadow-sm">
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

        {route.trips.length <= 1
          ? route.stops.map((stop, i) => renderStopCard(stop, i, true))
          : route.trips.map((trip, tripPos) => {
              const tripStops = route.stops.filter(s => s.tripId === trip.id);
              const priorTrip = route.trips[tripPos - 1];
              const isLastTrip = tripPos === route.trips.length - 1;
              const allTripStopsResolved =
                tripStops.length > 0 && tripStops.every(s => s.status !== 'PENDING');
              // ルート自体が未運送開始の間は、1便目もまだ「運送開始」待ちのため専用ボタンは出さない
              // （運送開始と同時に1便目は自動的に進行中になる）
              const canStart =
                route.status !== 'PENDING' &&
                trip.status === 'PENDING' &&
                (!priorTrip || priorTrip.status === 'COMPLETED');
              const blockStyle = TRIP_BLOCK_STYLES[trip.status];
              return (
                <div key={trip.id} className={`overflow-hidden rounded-lg border-2 ${blockStyle.border}`}>
                  <div className={`flex items-center justify-between px-3 py-2 ${blockStyle.head}`}>
                    <p className="text-sm font-bold">{trip.tripIndex + 1}便</p>
                    <span className="text-xs font-medium">
                      {trip.status === 'COMPLETED' && trip.returnedAt
                        ? `完了・${format(new Date(trip.returnedAt), 'HH:mm')} 本社帰着`
                        : TRIP_STATUS_LABELS[trip.status]}
                    </span>
                  </div>
                  <div className="space-y-2 bg-white p-2">
                    {canStart && (
                      <button
                        onClick={() => startTrip(trip.id)}
                        disabled={tripActionId === trip.id}
                        className="w-full rounded bg-orange-500 py-3 text-sm font-bold text-white disabled:opacity-50"
                      >
                        {tripActionId === trip.id ? '更新中...' : `${trip.tripIndex + 1}便を開始`}
                      </button>
                    )}
                    {tripStops.map((stop, i) => renderStopCard(stop, i, trip.status === 'IN_PROGRESS'))}
                    {!isLastTrip && trip.status === 'IN_PROGRESS' && allTripStopsResolved && (
                      <button
                        onClick={() => completeTrip(trip.id)}
                        disabled={tripActionId === trip.id}
                        className="w-full rounded bg-green-600 py-3 text-sm font-bold text-white disabled:opacity-50"
                      >
                        {tripActionId === trip.id ? '更新中...' : 'この便を完了して本社へ'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

        {route.status === 'COMPLETED' && (
          route.returnedAt ? (
            <p className="rounded-lg border border-green-200 bg-green-50 py-3 text-center text-sm font-bold text-green-700">
              {format(new Date(route.returnedAt), 'HH:mm')} に帰社しました
              {route.returnedByDispatcher && '（本部による操作）'}
            </p>
          ) : (
            <button
              onClick={markReturned}
              disabled={markingReturned}
              className="w-full rounded bg-green-600 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {markingReturned ? '更新中...' : '帰社'}
            </button>
          )
        )}
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
