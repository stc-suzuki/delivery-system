'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { io, Socket } from 'socket.io-client';
import { TOCHIGI_DEPOT } from '@/lib/routeOptimizer';

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// 赤（#dc2626）は到着希望時刻ありの停車地マーカーの警告色として予約しているため、識別色パレットには含めない
const ROUTE_COLORS = [
  '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2',
  '#db2777', '#65a30d', '#ea580c', '#4f46e5',
];

type RouteInfo = {
  id: string;
  truckPlate: string;
  driverName: string;
  stops: { lat: number; lng: number; order: number; name: string; status: string }[];
};

type Props = {
  routes: RouteInfo[];
  selectedRouteId?: string | null;
  onTruckClick?: (routeId: string) => void;
  // 地図の初期表示中心（本社座標）。未指定時はSystemSetting未取得時のフォールバック値を使う
  depotCenter?: { lat: number; lng: number };
};

export default function TrackingMap({ routes, selectedRouteId = null, onTruckClick, depotCenter = TOCHIGI_DEPOT }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayersRef = useRef<L.Layer[]>([]);
  const truckMarkersRef = useRef<Record<string, L.Marker>>({});
  const socketRef = useRef<Socket | null>(null);
  // socketハンドラは初回マウント時にしか再生成されないため、最新の選択状態をrefで参照する
  const selectedRouteIdRef = useRef<string | null>(selectedRouteId);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView(
      [depotCenter.lat, depotCenter.lng],
      10
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    mapRef.current = map;

    // Socket.io でトラック位置をリアルタイム受信
    socketRef.current = io({ path: '/api/socket' });
    socketRef.current.on(
      'tracking:update',
      (payload: { routeId: string; lat: number; lng: number }) => {
        const dimmed = selectedRouteIdRef.current !== null && selectedRouteIdRef.current !== payload.routeId;
        const route = routes.find(r => r.id === payload.routeId);
        const label = route ? `${route.truckPlate} / ${route.driverName}` : payload.routeId;

        const truckIcon = L.divIcon({
          className: '',
          html: `<div style="font-size:26px;line-height:1;cursor:pointer;opacity:${dimmed ? 0.35 : 1};" title="${label}">🚚</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });

        let marker = truckMarkersRef.current[payload.routeId];
        if (!marker) {
          marker = L.marker([payload.lat, payload.lng], { icon: truckIcon })
            .addTo(map)
            .on('click', () => onTruckClick?.(payload.routeId));
          truckMarkersRef.current[payload.routeId] = marker;
        } else {
          marker.setLatLng([payload.lat, payload.lng]);
        }
      }
    );

    return () => {
      socketRef.current?.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 選択中ルート以外のトラックアイコンを薄く表示する（選択状態が変わるたびに既存マーカーへ反映）
  useEffect(() => {
    selectedRouteIdRef.current = selectedRouteId;
    Object.entries(truckMarkersRef.current).forEach(([routeId, marker]) => {
      const el = marker.getElement();
      if (!el) return;
      const dimmed = selectedRouteId !== null && selectedRouteId !== routeId;
      el.style.opacity = dimmed ? '0.35' : '1';
    });
  }, [selectedRouteId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // 既存ルートレイヤーを削除
    routeLayersRef.current.forEach(l => map.removeLayer(l));
    routeLayersRef.current = [];

    routes.forEach((route, i) => {
      const sorted = [...route.stops].sort((a, b) => a.order - b.order);
      if (sorted.length === 0) return;

      const dimmed = selectedRouteId !== null && selectedRouteId !== route.id;
      const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
      const latlngs = sorted.map(s => [s.lat, s.lng] as L.LatLngTuple);

      // ルート破線（選択中のルートだけ太く・不透明、それ以外は薄くする）
      const line = L.polyline(latlngs, {
        color,
        weight: dimmed ? 2 : 4,
        opacity: dimmed ? 0.3 : 1,
        dashArray: '6 4',
      }).addTo(map);
      routeLayersRef.current.push(line);

      // 停車地マーカー
      sorted.forEach(stop => {
        const icon = L.divIcon({
          className: '',
          html: `<div style="
            background:${stop.status === 'COMPLETED' ? '#16a34a' : stop.status === 'SKIPPED' ? '#94a3b8' : color};
            color:#fff;border-radius:50%;
            width:20px;height:20px;
            display:flex;align-items:center;justify-content:center;
            font-size:10px;font-weight:bold;
            border:2px solid white;
            box-shadow:0 1px 3px rgba(0,0,0,.4);
            opacity:${dimmed ? 0.35 : 1};
          ">${stop.order + 1}</div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });
        const marker = L.marker([stop.lat, stop.lng], { icon })
          .bindPopup(`${stop.name}<br>${stop.status === 'COMPLETED' ? '✅ 完了' : stop.status === 'SKIPPED' ? '⏭ スキップ' : '⏳ 未訪問'}`)
          .addTo(map);
        routeLayersRef.current.push(marker);
      });
    });
  }, [routes, selectedRouteId]);

  // 全停車地が見えるようにズーム調整（ルートデータが変わった時だけ。選択状態の変化では再フィットしない）
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const allPoints = routes.flatMap(r => r.stops.map(s => [s.lat, s.lng] as L.LatLngTuple));
    if (allPoints.length > 0) {
      map.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40], maxZoom: 13 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes]);

  return <div ref={containerRef} className="h-full w-full" />;
}
