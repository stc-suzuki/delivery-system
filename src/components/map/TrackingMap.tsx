'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { io, Socket } from 'socket.io-client';
import { TOCHIGI_DEPOT } from '@/lib/routeOptimizer';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const ROUTE_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5',
];

type RouteInfo = {
  id: string;
  truckPlate: string;
  driverName: string;
  stops: { lat: number; lng: number; order: number; name: string; status: string }[];
};

type Props = {
  routes: RouteInfo[];
  onTruckClick?: (routeId: string) => void;
};

export default function TrackingMap({ routes, onTruckClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayersRef = useRef<L.Layer[]>([]);
  const truckMarkersRef = useRef<Record<string, L.Marker>>({});
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView(
      [TOCHIGI_DEPOT.lat, TOCHIGI_DEPOT.lng],
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
        const routeIndex = routes.findIndex(r => r.id === payload.routeId);
        const color = ROUTE_COLORS[routeIndex % ROUTE_COLORS.length];

        const truckIcon = L.divIcon({
          className: '',
          html: `<div style="font-size:26px;line-height:1;cursor:pointer;" title="${payload.routeId}">🚚</div>`,
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // 既存ルートレイヤーを削除
    routeLayersRef.current.forEach(l => map.removeLayer(l));
    routeLayersRef.current = [];

    routes.forEach((route, i) => {
      const sorted = [...route.stops].sort((a, b) => a.order - b.order);
      if (sorted.length === 0) return;

      const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
      const latlngs = sorted.map(s => [s.lat, s.lng] as L.LatLngTuple);

      // ルート破線
      const line = L.polyline(latlngs, { color, weight: 2, dashArray: '6 4' }).addTo(map);
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

    // 全停車地が見えるようにズーム調整
    const allPoints = routes.flatMap(r => r.stops.map(s => [s.lat, s.lng] as L.LatLngTuple));
    if (allPoints.length > 0) {
      map.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40], maxZoom: 13 });
    }
  }, [routes]);

  return <div ref={containerRef} className="h-full w-full" />;
}
