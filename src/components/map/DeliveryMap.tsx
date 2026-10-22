'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { TOCHIGI_DEPOT } from '@/lib/routeOptimizer';

// Leaflet のデフォルトアイコン画像パス修正
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export type RouteForMap = {
  id: string;
  color: string;
  stops: { lat: number; lng: number; order: number; name?: string }[];
};

type Props = {
  routes: RouteForMap[];
  onLocationClick?: (lngLat: { lat: number; lng: number }) => void;
  // 地図の初期表示中心（本社座標）。未指定時はSystemSetting未取得時のフォールバック値を使う
  depotCenter?: { lat: number; lng: number };
  // 位置を手で直すためのピン（配送先管理）。onPinMoveを渡すと、ピンのドラッグ・地図のクリックで
  // 新しい位置を知らせる
  editablePin?: { lat: number; lng: number } | null;
  onPinMove?: (latLng: { lat: number; lng: number }) => void;
};

// 位置を合わせやすいよう、ピンを出すときはこの拡大率以上にする
const PIN_ZOOM = 16;

export default function DeliveryMap({ routes, onLocationClick, depotCenter = TOCHIGI_DEPOT, editablePin, onPinMove }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);
  const pinRef = useRef<L.Marker | null>(null);
  // 地図の作成時に登録したイベントから、最新のコールバックを呼ぶため
  const onPinMoveRef = useRef(onPinMove);
  onPinMoveRef.current = onPinMove;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView(
      [depotCenter.lat, depotCenter.lng],
      10
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      onLocationClick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
      onPinMoveRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      pinRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!editablePin) {
      if (pinRef.current) {
        map.removeLayer(pinRef.current);
        pinRef.current = null;
      }
      return;
    }
    const latLng = L.latLng(editablePin.lat, editablePin.lng);
    if (!pinRef.current) {
      const pin = L.marker(latLng, { draggable: true }).addTo(map);
      pin.on('dragend', () => {
        const p = pin.getLatLng();
        onPinMoveRef.current?.({ lat: p.lat, lng: p.lng });
      });
      pinRef.current = pin;
    } else {
      pinRef.current.setLatLng(latLng);
    }
    if (pinRef.current.dragging) {
      if (onPinMoveRef.current) pinRef.current.dragging.enable();
      else pinRef.current.dragging.disable();
    }
    // 別の配送先を開いたときなど、ピンが見えていない・地図が引きすぎのときだけ寄せる
    // （ドラッグ直後に地図が動かないように）
    if (map.getZoom() < PIN_ZOOM - 2 || !map.getBounds().contains(latLng)) {
      map.setView(latLng, Math.max(map.getZoom(), PIN_ZOOM));
    }
  }, [editablePin?.lat, editablePin?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // 既存レイヤーを削除
    layersRef.current.forEach(l => map.removeLayer(l));
    layersRef.current = [];

    routes.forEach(route => {
      if (route.stops.length === 0) return;
      const sorted = [...route.stops].sort((a, b) => a.order - b.order);
      const latlngs = sorted.map(s => [s.lat, s.lng] as L.LatLngTuple);

      // ルート線
      const line = L.polyline(latlngs, { color: route.color, weight: 3 }).addTo(map);
      layersRef.current.push(line);

      // 停車地マーカー
      sorted.forEach(stop => {
        const icon = L.divIcon({
          className: '',
          html: `<div style="
            background:${route.color};
            color:#fff;
            border-radius:50%;
            width:24px;height:24px;
            display:flex;align-items:center;justify-content:center;
            font-size:12px;font-weight:bold;
            border:2px solid white;
            box-shadow:0 1px 3px rgba(0,0,0,.4);
          ">${stop.order + 1}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const marker = L.marker([stop.lat, stop.lng], { icon })
          .bindPopup(stop.name ?? `停車地 ${stop.order + 1}`)
          .addTo(map);
        layersRef.current.push(marker);
      });
    });

    // 全停車地が見えるようにズーム調整
    const allPoints = routes.flatMap(r => r.stops.map(s => [s.lat, s.lng] as L.LatLngTuple));
    if (allPoints.length > 0) {
      map.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40], maxZoom: 13 });
    }
  }, [routes]);

  return <div ref={containerRef} className="h-full w-full rounded-lg" />;
}
