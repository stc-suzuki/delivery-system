'use client';

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { io, Socket } from 'socket.io-client';
import { TOCHIGI_DEPOT } from '@/lib/routeOptimizer';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

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
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const truckMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [TOCHIGI_DEPOT.lng, TOCHIGI_DEPOT.lat],
      zoom: 9,
    });

    socketRef.current = io({ path: '/api/socket' });
    socketRef.current.on('tracking:update', (payload: { routeId: string; lat: number; lng: number }) => {
      const map = mapRef.current;
      if (!map) return;
      let marker = truckMarkersRef.current[payload.routeId];
      if (!marker) {
        const el = document.createElement('div');
        el.style.fontSize = '24px';
        el.textContent = '🚚';
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => onTruckClick?.(payload.routeId));
        marker = new mapboxgl.Marker({ element: el }).setLngLat([payload.lng, payload.lat]).addTo(map);
        truckMarkersRef.current[payload.routeId] = marker;
      } else {
        marker.setLngLat([payload.lng, payload.lat]);
      }
    });

    return () => {
      socketRef.current?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      routes.forEach(route => {
        const sourceId = `track-route-${route.id}`;
        const layerId = `track-line-${route.id}`;
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);

        const sorted = [...route.stops].sort((a, b) => a.order - b.order);
        if (sorted.length === 0) return;

        map.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: sorted.map(s => [s.lng, s.lat]) },
          },
        });
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#94a3b8', 'line-width': 2, 'line-dasharray': [2, 2] },
        });
      });
    };

    if (map.isStyleLoaded()) draw();
    else map.once('load', draw);
  }, [routes]);

  return <div ref={containerRef} className="h-full w-full" />;
}
