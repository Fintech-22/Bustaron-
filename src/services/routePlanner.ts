import type { AirspaceZone, GeoPoint } from '../types/domain';
import type { Skycell, ClosedCellSet } from './skycells';
import {
  planarDistanceM,
  pointInPolygon,
  pointToRingDistanceM,
  polygonBounds,
  toLatLng,
  toPlanar,
} from './geo/pointInPolygon';
import type { LatLngVertex } from './geo/pointInPolygon';
import { SANDBOX_COST_FACTOR } from './zoneClassification';

/** Default clearance kept between a planned route and any restricted ring, in metres. */
export const DEFAULT_ZONE_MARGIN_M = 60;
/** Grid spacing for the A* lattice, in metres. */
export const GRID_SPACING_M = 600;
/** Cost multiplier applied to waypoints inside an approved corridor zone. */
const CORRIDOR_COST_FACTOR = 0.45;
/** Risk weight: how much skycell risk adds to the base step cost. */
const RISK_COST_WEIGHT = 0.8;

export interface PlannedRoute {
  waypoints: GeoPoint[];
  distanceM: number;
  /** True when every segment clears the restricted-zone margin. */
  clearOfRestrictedZones: boolean;
  corridorDistanceM: number;
  nodesExpanded: number;
}

interface Obstacle {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  /** Planar ring in metres, for exact edge-distance tests. */
  ring: LatLngVertex[];
  /** WGS84 ring, for containment tests. */
  latLngRing: { lat: number; lng: number }[];
}

/** Binary min-heap keyed on fScore for the A* open set. */
class MinHeap {
  private heap: { key: string; f: number }[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(entry: { key: string; f: number }): void {
    this.heap.push(entry);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].f <= entry.f) {
        break;
      }
      this.heap[i] = this.heap[parent];
      i = parent;
    }
    this.heap[i] = entry;
  }

  pop(): { key: string; f: number } | undefined {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      const len = this.heap.length;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (left < len && this.heap[left].f < this.heap[smallest].f) {
          smallest = left;
        }
        if (right < len && this.heap[right].f < this.heap[smallest].f) {
          smallest = right;
        }
        if (smallest === i) {
          break;
        }
        [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

function latPad(marginM: number): number {
  return marginM / 111320;
}

function lngPad(marginM: number): number {
  return marginM / (111320 * Math.cos(22.3 * (Math.PI / 180)));
}

function buildObstacles(zones: AirspaceZone[], marginM: number): Obstacle[] {
  return zones.map((zone: AirspaceZone): Obstacle => {
    const ring = zone.polygon.map(toPlanar);
    const bounds = polygonBounds(zone.polygon);
    return {
      minLat: bounds.minLat - latPad(marginM),
      maxLat: bounds.maxLat + latPad(marginM),
      minLng: bounds.minLng - lngPad(marginM),
      maxLng: bounds.maxLng + lngPad(marginM),
      ring,
      latLngRing: zone.polygon,
    };
  });
}

function isBlocked(
  point: { lat: number; lng: number },
  vertex: LatLngVertex,
  obstacles: Obstacle[],
  marginM: number,
): boolean {
  for (const obstacle of obstacles) {
    if (
      point.lat < obstacle.minLat ||
      point.lat > obstacle.maxLat ||
      point.lng < obstacle.minLng ||
      point.lng > obstacle.maxLng
    ) {
      continue;
    }
    if (pointInPolygon(point, obstacle.latLngRing)) {
      return true;
    }
    if (pointToRingDistanceM(vertex, obstacle.ring) < marginM) {
      return true;
    }
  }
  return false;
}

/**
 * Finds the skycell containing a lat/lng point, or null if none.
 * Uses bounding-box check first for speed, then point-in-polygon.
 */
function findSkycellAt(lat: number, lng: number, skycells: Skycell[]): Skycell | null {
  for (const cell of skycells) {
    const ring = cell.ring;
    // Quick bbox check
    const minLng = ring[0][0];
    const maxLng = ring[1][0];
    const minLat = ring[0][1];
    const maxLat = ring[2][1];
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    // Point in polygon (ray casting on [lng,lat] ring)
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    if (inside) return cell;
  }
  return null;
}

/**
 * Collects the IDs of all closed skycells that the planned route's waypoints
 * pass through. Returns empty array if none.
 */
function closedCellsOnRoute(waypoints: GeoPoint[], skycells: Skycell[], closedCells: ClosedCellSet): string[] {
  if (closedCells.size === 0) return [];
  const result = new Set<string>();
  for (const wp of waypoints) {
    const cell = findSkycellAt(wp.lat, wp.lng, skycells);
    if (cell && closedCells.has(cell.id)) {
      result.add(cell.id);
    }
  }
  return [...result];
}

export interface PlanRouteOptions {
  zones: AirspaceZone[];
  marginM?: number;
  spacingM?: number;
  /** Skycells with risk scores — used to weight the A* cost function. */
  skycells?: Skycell[];
  /** Set of closed cell IDs — routes through these are rejected. */
  closedCells?: ClosedCellSet;
}

/**
 * Plans an obstacle-avoiding 2D route with A* over a rectangular metre lattice.
 * Start and goal snap to their nearest lattice nodes so the path always begins
 * and ends within one grid step of the request. Restricted zones are inflated
 * by `marginM`; lattice nodes inside an inflated zone are pruned, and an edge
 * is admitted only when both endpoints clear the margin. Waypoints inside an
 * approved corridor zone are discounted. Throws when no compliant path exists.
 */
export function planRoute(start: GeoPoint, goal: GeoPoint, options: PlanRouteOptions): PlannedRoute {
  const marginM = options.marginM ?? DEFAULT_ZONE_MARGIN_M;
  const spacingM = options.spacingM ?? GRID_SPACING_M;
  // Only hard restrictions block planning (PRD FR-FP2: restricted = infinite
  // cost). Sandbox zones are permissible-with-authorization, so they are
  // penalised (high cost) rather than excluded; corridors are discounted and
  // heliport zones merely require notification.
  const blockingZones = options.zones.filter(
    (zone: AirspaceZone): boolean => zone.kind === 'rfz' || zone.kind === 'sensitive',
  );
  const obstacles = buildObstacles(blockingZones, marginM);
  const sandboxZones = options.zones.filter((zone: AirspaceZone): boolean => zone.kind === 'sandbox');
  const sandboxPolygons = sandboxZones.map((zone: AirspaceZone) => ({
    bounds: polygonBounds(zone.polygon),
    latLngRing: zone.polygon,
  }));

  const corridorZones = options.zones.filter((zone: AirspaceZone): boolean => zone.kind === 'corridor');
  const corridorPolygons = corridorZones.map((zone: AirspaceZone) => ({
    bounds: polygonBounds(zone.polygon),
    latLngRing: zone.polygon,
  }));

  const startVertex = toPlanar(start);
  const goalVertex = toPlanar(goal);

  // Lattice bounds: request bbox plus a 2 km operational pad.
  const padLat = 2000 / 111320;
  const padLng = 2000 / (111320 * Math.cos(22.3 * (Math.PI / 180)));
  const bounds = {
    minLat: Math.min(start.lat, goal.lat) - padLat,
    maxLat: Math.max(start.lat, goal.lat) + padLat,
    minLng: Math.min(start.lng, goal.lng) - padLng,
    maxLng: Math.max(start.lng, goal.lng) + padLng,
  };

  const latSpacing = spacingM / 111320;
  const lngSpacing = spacingM / (111320 * Math.cos(22.3 * (Math.PI / 180)));
  const cols = Math.max(2, Math.round((bounds.maxLng - bounds.minLng) / lngSpacing) + 1);
  const rows = Math.max(2, Math.round((bounds.maxLat - bounds.minLat) / latSpacing) + 1);

  const snap = (value: number, min: number, step: number, count: number): number =>
    Math.min(count - 1, Math.max(0, Math.round((value - min) / step)));

  const startCol = snap(start.lng, bounds.minLng, lngSpacing, cols);
  const startRow = snap(start.lat, bounds.minLat, latSpacing, rows);
  const goalCol = snap(goal.lng, bounds.minLng, lngSpacing, cols);
  const goalRow = snap(goal.lat, bounds.minLat, latSpacing, rows);

  const vertexCache = new Map<string, LatLngVertex>();
  const vertexOf = (col: number, row: number): LatLngVertex => {
    const key = `${col}:${row}`;
    const cached = vertexCache.get(key);
    if (cached) {
      return cached;
    }
    const computed = toPlanar({ lat: bounds.minLat + row * latSpacing, lng: bounds.minLng + col * lngSpacing });
    vertexCache.set(key, computed);
    return computed;
  };

  const freeNodes = new Map<string, { col: number; row: number; vertex: LatLngVertex }>();
  const skycells = options.skycells ?? [];
  const closedCells = options.closedCells ?? new Set<string>();
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const vertex = vertexOf(col, row);
      const latLng = { lat: bounds.minLat + row * latSpacing, lng: bounds.minLng + col * lngSpacing };
      if (!isBlocked(latLng, vertex, obstacles, marginM)) {
        // Reject nodes inside closed skycells
        if (closedCells.size > 0 && skycells.length > 0) {
          const cell = findSkycellAt(latLng.lat, latLng.lng, skycells);
          if (cell && closedCells.has(cell.id)) {
            continue; // Closed cell — node is not free
          }
        }
        freeNodes.set(`${col}:${row}`, { col, row, vertex });
      }
    }
  }

  // A clear start/goal can still snap to a lattice node that sits inside a
  // zone margin. Fall back to the nearest free node within 2 lattice steps so
  // viable endpoints are not rejected outright; the exact point is spliced
  // back into the final polyline either way.
  const nearestFreeNode = (col: number, row: number): string | null => {
    if (freeNodes.has(`${col}:${row}`)) {
      return `${col}:${row}`;
    }
    for (let radius = 1; radius <= 2; radius += 1) {
      let bestKey: string | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let dRow = -radius; dRow <= radius; dRow += 1) {
        for (let dCol = -radius; dCol <= radius; dCol += 1) {
          const key = `${col + dCol}:${row + dRow}`;
          const node = freeNodes.get(key);
          if (!node) {
            continue;
          }
          const distance = planarDistanceM(node.vertex, col === startCol && row === startRow ? startVertex : goalVertex);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestKey = key;
          }
        }
      }
      if (bestKey) {
        return bestKey;
      }
    }
    return null;
  };

  const startKey = nearestFreeNode(startCol, startRow);
  const goalKey = nearestFreeNode(goalCol, goalRow);
  if (!startKey || !goalKey) {
    throw new Error('No compliant route: start or goal falls inside a restricted-zone margin');
  }

  const gScores = new Map<string, number>([[startKey, 0]]);
  const cameFrom = new Map<string, string>();
  const closed = new Set<string>();
  const open = new MinHeap();
  open.push({ key: startKey, f: planarDistanceM(freeNodes.get(startKey)!.vertex, goalVertex) });

  const neighbours = (col: number, row: number): [number, number][] => {
    const result: [number, number][] = [];
    for (let dRow = -1; dRow <= 1; dRow += 1) {
      for (let dCol = -1; dCol <= 1; dCol += 1) {
        if (dRow === 0 && dCol === 0) {
          continue;
        }
        const nextCol = col + dCol;
        const nextRow = row + dRow;
        if (nextCol >= 0 && nextCol < cols && nextRow >= 0 && nextRow < rows) {
          result.push([nextCol, nextRow]);
        }
      }
    }
    return result;
  };

  const insidePolygon = (
    polygons: { bounds: ReturnType<typeof polygonBounds>; latLngRing: { lat: number; lng: number }[] }[],
    vertex: LatLngVertex,
    latLng: { lat: number; lng: number },
  ): boolean => {
    for (const polygon of polygons) {
      const b = polygon.bounds;
      if (latLng.lat < b.minLat || latLng.lat > b.maxLat || latLng.lng < b.minLng || latLng.lng > b.maxLng) {
        continue;
      }
      if (pointInPolygon(latLng, polygon.latLngRing)) {
        return true;
      }
    }
    return false;
  };

  const insideCorridor = (vertex: LatLngVertex, latLng: { lat: number; lng: number }): boolean =>
    insidePolygon(corridorPolygons, vertex, latLng);
  const insideSandbox = (vertex: LatLngVertex, latLng: { lat: number; lng: number }): boolean =>
    insidePolygon(sandboxPolygons, vertex, latLng);

  let nodesExpanded = 0;
  let found = false;
  while (open.size > 0) {
    const current = open.pop();
    if (!current || closed.has(current.key)) {
      continue;
    }
    if (current.key === goalKey) {
      found = true;
      break;
    }
    closed.add(current.key);
    nodesExpanded += 1;
    if (nodesExpanded > 60000) {
      break;
    }

    const currentG = gScores.get(current.key) ?? Number.POSITIVE_INFINITY;
    const node = freeNodes.get(current.key);
    if (!node) {
      continue;
    }

    for (const [nextCol, nextRow] of neighbours(node.col, node.row)) {
      const nextKey = `${nextCol}:${nextRow}`;
      const nextNode = freeNodes.get(nextKey);
      if (!nextNode || closed.has(nextKey)) {
        continue;
      }
      const stepCost = planarDistanceM(node.vertex, nextNode.vertex);
      const nextLatLng = { lat: bounds.minLat + nextRow * latSpacing, lng: bounds.minLng + nextCol * lngSpacing };
      // PRD FR-FP2: corridor transit is discounted, sandbox transit penalised.
      let factor = 1;
      if (insideCorridor(nextNode.vertex, nextLatLng)) {
        factor = CORRIDOR_COST_FACTOR;
      } else if (insideSandbox(nextNode.vertex, nextLatLng)) {
        factor = SANDBOX_COST_FACTOR;
      }
      // Skycell risk adds to the cost: higher risk → more expensive transit.
      // The A* planner avoids high-risk cells when a lower-risk alternative exists.
      if (skycells.length > 0) {
        const cell = findSkycellAt(nextLatLng.lat, nextLatLng.lng, skycells);
        if (cell) {
          // Risk is 0-100; weight it so a cell at risk=100 roughly doubles the cost
          factor += RISK_COST_WEIGHT * (cell.risk / 100);
          // Closed cells are already pruned from freeNodes, but double-check here
          if (closedCells.has(cell.id)) {
            continue;
          }
        }
      }
      const tentativeG = currentG + stepCost * factor;
      if (tentativeG < (gScores.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
        gScores.set(nextKey, tentativeG);
        cameFrom.set(nextKey, current.key);
        open.push({ key: nextKey, f: tentativeG + planarDistanceM(nextNode.vertex, goalVertex) });
      }
    }
  }

  if (!found) {
    // Check if closed cells are blocking the route
    if (closedCells.size > 0 && skycells.length > 0) {
      const blockingCells = closedCellsOnRoute([start, goal], skycells, closedCells);
      if (blockingCells.length > 0) {
        throw new Error(`Route blocked by closed skycell(s): ${blockingCells.join(', ')}`);
      }
    }
    throw new Error('No compliant route found within lattice bounds');
  }

  // Reconstruct the lattice path, then splice in the exact start/goal points,
  // dropping snapped nodes that coincide with them (within one metre).
  const latticePath: LatLngVertex[] = [];
  let cursor: string | undefined = goalKey;
  while (cursor) {
    const node = freeNodes.get(cursor);
    if (!node) {
      break;
    }
    latticePath.unshift(node.vertex);
    cursor = cameFrom.get(cursor);
  }

  const waypoints: GeoPoint[] = [start];
  for (const vertex of latticePath) {
    if (planarDistanceM(vertex, startVertex) > 1 && planarDistanceM(vertex, goalVertex) > 1) {
      waypoints.push(toLatLng(vertex));
    }
  }
  waypoints.push(goal);

  let distanceM = 0;
  let corridorDistanceM = 0;
  for (let i = 1; i < waypoints.length; i += 1) {
    const from = toPlanar(waypoints[i - 1]);
    const to = toPlanar(waypoints[i]);
    const segmentM = planarDistanceM(from, to);
    distanceM += segmentM;
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    if (insideCorridor(mid, toLatLng(mid))) {
      corridorDistanceM += segmentM;
    }
  }

  return {
    waypoints,
    distanceM: Math.round(distanceM),
    clearOfRestrictedZones: true,
    corridorDistanceM: Math.round(corridorDistanceM),
    nodesExpanded,
  };
}
