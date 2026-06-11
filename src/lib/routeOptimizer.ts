type Coord = { lat: number; lng: number };

export function haversine(a: Coord, b: Coord): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
    Math.cos((b.lat * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function clusterLocations<T extends Coord>(locations: T[], k: number): T[][] {
  let centroids: Coord[] = locations
    .slice()
    .sort(() => Math.random() - 0.5)
    .slice(0, k)
    .map(l => ({ lat: l.lat, lng: l.lng }));

  let assignments = new Array(locations.length).fill(0);

  for (let iter = 0; iter < 100; iter++) {
    const next = locations.map(loc => {
      let best = 0, minD = Infinity;
      centroids.forEach((c, i) => {
        const d = haversine(loc, c);
        if (d < minD) { minD = d; best = i; }
      });
      return best;
    });
    if (next.every((v, i) => v === assignments[i])) break;
    assignments = next;
    centroids = centroids.map((_, i) => {
      const group = locations.filter((_, j) => assignments[j] === i);
      if (!group.length) return centroids[i];
      return {
        lat: group.reduce((s, l) => s + l.lat, 0) / group.length,
        lng: group.reduce((s, l) => s + l.lng, 0) / group.length,
      };
    });
  }

  return centroids.map((_, i) => locations.filter((_, j) => assignments[j] === i));
}

export function nearestNeighborOrder<T extends Coord>(depot: Coord, stops: T[]): T[] {
  const unvisited = [...stops];
  const route: T[] = [];
  let current: Coord = depot;
  while (unvisited.length) {
    let bestIdx = 0, minD = Infinity;
    unvisited.forEach((s, i) => {
      const d = haversine(current, s);
      if (d < minD) { minD = d; bestIdx = i; }
    });
    current = unvisited[bestIdx];
    route.push(...unvisited.splice(bestIdx, 1));
  }
  return route;
}

export function routeDistance(depot: Coord, stops: Coord[]): number {
  let total = 0;
  let current = depot;
  for (const s of stops) {
    total += haversine(current, s);
    current = s;
  }
  return total;
}

export const TOCHIGI_DEPOT: Coord = { lat: 36.5657, lng: 139.8836 };
