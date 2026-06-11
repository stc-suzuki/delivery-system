'use client';

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { TOCHIGI_DEPOT } from '@/lib/routeOptimizer';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

export type RouteForMap = {
  id: string;
  color: string;
  stops: { lat: number; lng: number; order: number; name?: string }[];
};

type Props = {
  routes: RouteForMap[];
  onLocationClick?: (lngLat: { lat: number; lng: number }) => void;
};

export default function DeliveryMap({ routes, onLocationClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [TOCHIGI_DEPOT.lng, TOCHIGI_DEPOT.lat],
      zoom: 9,
    });

    if (onLocationClick) {
      mapRef.current.on('click', e => {
        onLocationClick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
    }

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      // 既存マーカー・レイヤーをクリア
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      routes.forEach(route => {
        const layerId = `route-${route.id}`;
        const sourceId = `route-source-${route.id}`;
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      });

      routes.forEach(route => {
        if (route.stops.length === 0) return;
        const sorted = [...route.stops].sort((a, b) => a.order - b.order);
        const coordinates = sorted.map(s => [s.lng, s.lat]);

        const sourceId = `route-source-${route.id}`;
        const layerId = `route-${route.id}`;

        map.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates },
          },
        });
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': route.color, 'line-width': 3 },
        });

        sorted.forEach(stop => {
          const el = document.createElement('div');
          el.style.background = route.color;
          el.style.color = '#fff';
          el.style.borderRadius = '50%';
          el.style.width = '24px';
          el.style.height = '24px';
          el.style.display = 'flex';
          el.style.alignItems = 'center';
          el.style.justifyContent = 'center';
          el.style.fontSize = '12px';
          el.style.fontWeight = 'bold';
          el.style.border = '2px solid white';
          el.textContent = String(stop.order + 1);

          const marker = new mapboxgl.Marker({ element: el })
            .setLngLat([stop.lng, stop.lat])
            .setPopup(new mapboxgl.Popup({ offset: 12 }).setText(stop.name ?? `停車地 ${stop.order + 1}`))
            .addTo(map);
          markersRef.current.push(marker);
        });
      });
    };

    if (map.isStyleLoaded()) {
      draw();
    } else {
      map.once('load', draw);
    }
  }, [routes]);

  return <div ref={containerRef} className="h-full w-full rounded-lg" />;
}
