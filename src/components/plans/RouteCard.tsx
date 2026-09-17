'use client';

import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { routeDistance, TOCHIGI_DEPOT } from '@/lib/routeOptimizer';

export type RouteStop = {
  id: string;
  locationId: string;
  name: string;
  lat: number;
  lng: number;
  stopOrder: number;
  scheduledTime: string | null;
  isTimeFixed: boolean;
  cargoRatio: number;
};

export type RouteData = {
  id: string;
  truckPlateNo: string;
  driverName: string;
  color: string;
  departureTime: string | null;
  stops: RouteStop[];
};

type Props = {
  route: RouteData;
  onReorder: (routeId: string, stops: RouteStop[]) => void;
};

function SortableStop({ stop, index }: { stop: RouteStop; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: stop.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1 text-sm"
    >
      <span {...attributes} {...listeners} className="cursor-grab text-gray-400">⠿</span>
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-300 text-xs font-bold text-white">
        {index + 1}
      </span>
      <span className="truncate">{stop.name}</span>
    </li>
  );
}

export default function RouteCard({ route, onReorder }: Props) {
  const distance = routeDistance(TOCHIGI_DEPOT, route.stops);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = route.stops.findIndex(s => s.id === active.id);
    const newIndex = route.stops.findIndex(s => s.id === over.id);
    const reordered = arrayMove(route.stops, oldIndex, newIndex).map((s, i) => ({ ...s, stopOrder: i }));
    onReorder(route.id, reordered);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: route.color }} />
          <span className="text-sm font-semibold">{route.truckPlateNo}</span>
          <span className="text-sm text-gray-500">/ {route.driverName}</span>
        </div>
        <div className="text-xs text-gray-500">
          {route.stops.length}件 ・ 約{distance.toFixed(1)}km
        </div>
      </div>
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={route.stops.map(s => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {route.stops.map((stop, i) => (
              <SortableStop key={stop.id} stop={stop} index={i} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}
