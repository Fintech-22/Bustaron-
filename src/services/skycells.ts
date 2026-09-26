import type { Drone, GeoPoint, Mission } from '../types/domain';

/**
 * Skycells — the PRD's airspace grid (FR-OP-V4 / S107): the HK operating area
 * divided into ~600 m cells, each colored by predicted occupancy.
 *
 * Occupancy is a deterministic function of the current fleet and mission set
 * (cell centrality relative to active drones + route legs), so the same state
 * always yields the same map and the cells move as the fleet moves. There is
 * no RNG anywhere — M3 replaces the scorer with real demand data behind the
 * same interface.
 */
export const SKYCELL_SIZE_M = 600;

/** Bounds match TacticalMap's schematic frame: the core HK operating area. */
const HK_BOUNDS = { minLat: 22.255, maxLat: 22.37, minLng: 114.095, maxLng: 114.25 };

/** ~111.32 km per degree of latitude; longitude shrinks by cos(lat). */
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG_AT_HK = 111_320 * Math.cos((22.31 * Math.PI) / 180);

export interface Skycell {
  id: string;
  row: number;
  col: number;
  /** Polygon ring [ [lng,lat], ... ] in GeoJSON order (closed not required). */
  ring: [number, number][];
  center: GeoPoint;
  /** 0..1 occupancy estimate for the current tick. */
  occupancy: number;
  /** PRD band: green = clear, yellow = light, orange = busy, red = congested. */
  band: 'clear' | 'light' | 'busy' | 'congested';
}

export type SkycellBand = Skycell['band'];

export const skycellBandColor: Record<SkycellBand, string> = {
  clear: '#4ade80',
  light: '#facc15',
  busy: '#fb923c',
  congested: '#ef4444',
};

export function skycellBounds(): typeof HK_BOUNDS {
  return { ...HK_BOUNDS };
}

function metersPerCell(): { latStep: number; lngStep: number } {
  return {
    latStep: SKYCELL_SIZE_M / M_PER_DEG_LAT,
    lngStep: SKYCELL_SIZE_M / M_PER_DEG_LNG_AT_HK,
  };
}

function bandFor(occupancy: number): SkycellBand {
  if (occupancy >= 0.7) return 'congested';
  if (occupancy >= 0.4) return 'busy';
  if (occupancy >= 0.15) return 'light';
  return 'clear';
}

function routeLegs(missions: Mission[]): { from: GeoPoint; to: GeoPoint }[] {
  const legs: { from: GeoPoint; to: GeoPoint }[] = [];
  for (const mission of missions) {
    for (let i = 1; i < mission.route.length; i += 1) {
      legs.push({ from: mission.route[i - 1], to: mission.route[i] });
    }
  }
  return legs;
}

function distancePointToSegmentM(point: GeoPoint, from: GeoPoint, to: GeoPoint): number {
  const ax = (point.lng - from.lng) * M_PER_DEG_LNG_AT_HK;
  const ay = (point.lat - from.lat) * M_PER_DEG_LAT;
  const bx = (to.lng - from.lng) * M_PER_DEG_LNG_AT_HK;
  const by = (to.lat - from.lat) * M_PER_DEG_LAT;
  const lengthSq = bx * bx + by * by;
  if (lengthSq === 0) {
    return Math.hypot(ax, ay);
  }
  const t = Math.max(0, Math.min(1, (ax * bx + ay * by) / lengthSq));
  return Math.hypot(ax - t * bx, ay - t * by);
}

/**
 * Builds the full skycell lattice for the current tick. Cells are returned
 * row-major; occupancy blends nearby drones (weight by inverse distance) and
 * active mission legs (cells the leg passes through get a boost).
 */
export function buildSkycells(drones: Drone[], missions: Mission[]): Skycell[] {
  const { latStep, lngStep } = metersPerCell();
  const rows = Math.ceil((HK_BOUNDS.maxLat - HK_BOUNDS.minLat) / latStep);
  const cols = Math.ceil((HK_BOUNDS.maxLng - HK_BOUNDS.minLng) / lngStep);
  const legs = routeLegs(missions);

  const cells: Skycell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const south = HK_BOUNDS.minLat + row * latStep;
      const west = HK_BOUNDS.minLng + col * lngStep;
      const center: GeoPoint = { lat: south + latStep / 2, lng: west + lngStep / 2 };

      let occupancy = 0;
      for (const drone of drones) {
        if (drone.status === 'grounded') continue;
        const dLat = (drone.position.lat - center.lat) * M_PER_DEG_LAT;
        const dLng = (drone.position.lng - center.lng) * M_PER_DEG_LNG_AT_HK;
        const distanceM = Math.hypot(dLat, dLng);
        const reach = drone.status === 'critical' ? 1_500 : 1_000;
        if (distanceM < reach) {
          occupancy += 0.45 * (1 - distanceM / reach);
        }
      }
      for (const leg of legs) {
        if (distancePointToSegmentM(center, leg.from, leg.to) < SKYCELL_SIZE_M / 2) {
          occupancy += 0.3;
        }
      }
      occupancy = Math.min(1, occupancy);

      cells.push({
        id: `cell-${row}-${col}`,
        row,
        col,
        ring: [
          [west, south],
          [west + lngStep, south],
          [west + lngStep, south + latStep],
          [west, south + latStep],
        ],
        center,
        occupancy,
        band: bandFor(occupancy),
      });
    }
  }
  return cells;
}

/** GeoJSON FeatureCollection for the grid source (fill + line share it). */
export function skycellsToGeoJson(cells: Skycell[]): unknown {
  return {
    type: 'FeatureCollection',
    features: cells.map((cell) => ({
      type: 'Feature',
      id: cell.id,
      properties: { id: cell.id, occupancy: cell.occupancy, band: cell.band },
      geometry: { type: 'Polygon', coordinates: [[...cell.ring, cell.ring[0]]] },
    })),
  };
}
