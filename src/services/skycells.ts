import type { Drone, GeoPoint, Mission, WeatherAlert } from '../types/domain';

/**
 * Skycells — the PRD's airspace grid (FR-OP-V4 / S107): the full HK operating
 * area divided into square cells, each scored for risk from weather, drone
 * occupancy, and population density.
 *
 * Risk is deterministic given the current fleet, mission set, weather, and a
 * static population raster baked from HK Census district data. Closed cells are
 * pinned to risk 100 and treated as restricted by the A* planner.
 */

/**
 * Cell size in metres — 500 m per side. The full HK bbox at 250 m generates
 * ~51k cells which is computationally expensive for the A* planner and the
 * browser's WebGL layer; 500 m yields ~12.8k cells which is detailed enough
 * for the traffic heatmap and risk routing while staying performant.
 */
export const SKYCELL_SIZE_M = 500;

/**
 * Full Hong Kong bounding box (covers HK Island, Kowloon, NT, Lantau, and
 * outlying islands). This replaces the old core-HK-only bounds.
 */
const HK_BOUNDS = {
  minLat: 22.15,
  maxLat: 22.60,
  minLng: 113.82,
  maxLng: 114.52,
};

/** ~111.32 km per degree of latitude; longitude shrinks by cos(lat). */
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG_AT_HK = 111_320 * Math.cos((22.35 * Math.PI) / 180);

/** PRD altitude bands (FR-OP-V6 / S109). */
export const SKYCELL_ALTITUDE_BANDS = [
  { label: '0-80 m', min: 0, max: 80 },
  { label: '80-160 m', min: 80, max: 160 },
  { label: '160-240 m', min: 160, max: 240 },
  { label: '240-320 m', min: 240, max: 320 },
  { label: '320-400 m', min: 320, max: 400 },
] as const;

export type AltitudeBandIndex = 0 | 1 | 2 | 3 | 4;

/**
 * Coarse HK population density by district (persons per km^2).
 * Source: HK Census 2021 district-level estimates, aggregated to a grid.
 * Each entry covers a lat/lng rectangle. Areas not covered default to 2,000
 * (rural / country park / open water).
 */
const POPULATION_RASTER: { bounds: typeof HK_BOUNDS; density: number }[] = [
  // Kowloon peninsula — densest urban area
  { bounds: { minLat: 22.28, maxLat: 22.35, minLng: 114.14, maxLng: 114.22 }, density: 43_000 },
  // Northern Kowloon / Sham Shui Po / Wong Tai Sin
  { bounds: { minLat: 22.33, maxLat: 22.37, minLng: 114.15, maxLng: 114.22 }, density: 39_000 },
  // HK Island north (Central, Wanchai, Causeway Bay)
  { bounds: { minLat: 22.26, maxLat: 22.30, minLng: 114.15, maxLng: 114.20 }, density: 26_000 },
  // HK Island mid-levels / Southern
  { bounds: { minLat: 22.23, maxLat: 22.28, minLng: 114.14, maxLng: 114.21 }, density: 15_000 },
  // Kwun Tong / Kowloon Bay industrial
  { bounds: { minLat: 22.30, maxLat: 22.34, minLng: 114.20, maxLng: 114.26 }, density: 21_000 },
  // Tsuen Wan / Kwai Chung / Tsing Yi
  { bounds: { minLat: 22.32, maxLat: 22.38, minLng: 114.08, maxLng: 114.16 }, density: 14_000 },
  // Sha Tin
  { bounds: { minLat: 22.36, maxLat: 22.42, minLng: 114.15, maxLng: 114.23 }, density: 9_500 },
  // Tuen Mun
  { bounds: { minLat: 22.36, maxLat: 22.42, minLng: 113.94, maxLng: 114.04 }, density: 7_800 },
  // Yuen Long
  { bounds: { minLat: 22.42, maxLat: 22.52, minLng: 114.00, maxLng: 114.08 }, density: 4_200 },
  // Tai Po
  { bounds: { minLat: 22.40, maxLat: 22.48, minLng: 114.12, maxLng: 114.22 }, density: 3_600 },
  // Tseung Kwan O
  { bounds: { minLat: 22.27, maxLat: 22.33, minLng: 114.22, maxLng: 114.30 }, density: 12_000 },
  // Tung Chung / North Lantau
  { bounds: { minLat: 22.27, maxLat: 22.33, minLng: 113.90, maxLng: 114.00 }, density: 5_500 },
  // Central HK Island (Mid-levels to Victoria Peak)
  { bounds: { minLat: 22.26, maxLat: 22.29, minLng: 114.14, maxLng: 114.16 }, density: 18_000 },
];

const DEFAULT_POP_DENSITY = 2_000;

/** Risk formula weights. */
const RISK_WEIGHT_WIND = 0.40;
const RISK_WEIGHT_OCCUPANCY = 0.30;
const RISK_WEIGHT_POPULATION = 0.30;

/** Normalization denominators. */
const WIND_NORM_KPH = 80;
const OCC_NORM_DRONES = 6;
const POP_NORM_PER_KM2 = 50_000;

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
  /** Altitude band index (0-4). */
  altitudeBand: AltitudeBandIndex;
  /** Risk score 0-100. Closed cells = 100. */
  risk: number;
  /** Current wind speed at cell center, km/h (interpolated from weather alerts). */
  windKph: number;
  /** Current temperature at cell center, degrees C (coarse HK seasonal model). */
  temperatureC: number;
  /** Cell area in km^2. */
  areaKm2: number;
  /** Population density (persons per km^2) from the static raster. */
  populationPerKm2: number;
  /** Whether an admin has closed this cell. */
  closed: boolean;
}

export type SkycellBand = Skycell['band'];

export const skycellBandColor: Record<SkycellBand, string> = {
  clear: '#4ade80',
  light: '#facc15',
  busy: '#fb923c',
  congested: '#ef4444',
};

/** Risk classification thresholds. */
export type RiskClass = 'low' | 'medium' | 'high' | 'critical';

export const riskClassThresholds: Record<RiskClass, number> = {
  low: 25,
  medium: 50,
  high: 75,
  critical: 100,
};

export function classifyRisk(risk: number): RiskClass {
  if (risk >= 75) return 'critical';
  if (risk >= 50) return 'high';
  if (risk >= 25) return 'medium';
  return 'low';
}

export function riskClassColor(risk: number): string {
  const cls = classifyRisk(risk);
  if (cls === 'critical') return '#ef4444';
  if (cls === 'high') return '#fb923c';
  if (cls === 'medium') return '#facc15';
  return '#4ade80';
}

/** Set of closed cell IDs — managed by the dashboard store. */
export type ClosedCellSet = Set<string>;

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

/** Look up population density for a lat/lng from the static raster. */
function populationAt(lat: number, lng: number): number {
  for (const tile of POPULATION_RASTER) {
    const b = tile.bounds;
    if (lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng) {
      return tile.density;
    }
  }
  return DEFAULT_POP_DENSITY;
}

/**
 * Interpolates wind speed at a cell center from the nearest weather alert.
 * If no alerts exist, returns a nominal 10 km/h (typical HK prevailing wind).
 */
function windAtCell(center: GeoPoint, weatherAlerts: WeatherAlert[]): number {
  if (weatherAlerts.length === 0) return 10;
  let nearest: WeatherAlert | null = null;
  let minDist = Number.POSITIVE_INFINITY;
  for (const alert of weatherAlerts) {
    // Use area centroid as the alert's reference point
    const cx = alert.area.reduce((s, p) => s + p.lng, 0) / alert.area.length;
    const cy = alert.area.reduce((s, p) => s + p.lat, 0) / alert.area.length;
    const dLat = (center.lat - cy) * M_PER_DEG_LAT;
    const dLng = (center.lng - cx) * M_PER_DEG_LNG_AT_HK;
    const dist = Math.hypot(dLat, dLng);
    if (dist < minDist) {
      minDist = dist;
      nearest = alert;
    }
  }
  return nearest ? nearest.windKph : 10;
}

/**
 * Coarse HK temperature model: September average ~28C near coast, decreasing
 * slightly with elevation. Since skycells are 2D, we use a lat/lng-based
 * interpolation from a nominal urban heat island center.
 */
function temperatureAtCell(center: GeoPoint): number {
  // Urban heat island: warmer near the harbour, cooler in NT and hills
  const harborLat = 22.30;
  const harborLng = 114.17;
  const dLat = (center.lat - harborLat) * M_PER_DEG_LAT;
  const dLng = (center.lng - harborLng) * M_PER_DEG_LNG_AT_HK;
  const distKm = Math.hypot(dLat, dLng) / 1000;
  // 28C at harbour, -0.5C per km away (coarse)
  return Math.round((28 - distKm * 0.5) * 10) / 10;
}

/**
 * Computes the risk score for a cell:
 *   risk = 100 * (0.40 * wind_norm + 0.30 * occ_norm + 0.30 * pop_norm)
 * where:
 *   wind_norm = min(windKph / 80, 1)
 *   occ_norm  = min(droneCount / 6, 1)  (derived from occupancy * 6)
 *   pop_norm  = min(popPerKm2 / 50000, 1)
 * Closed cells are pinned to 100.
 * Cells crossed by an RFZ are clamped to >= 90.
 */
export function computeRisk(
  windKph: number,
  occupancy: number,
  populationPerKm2: number,
  closed: boolean,
  rfzCrossed: boolean,
): number {
  if (closed) return 100;
  const windNorm = Math.min(windKph / WIND_NORM_KPH, 1);
  const droneCount = occupancy * OCC_NORM_DRONES;
  const occNorm = Math.min(droneCount / OCC_NORM_DRONES, 1);
  const popNorm = Math.min(populationPerKm2 / POP_NORM_PER_KM2, 1);
  const raw = 100 * (RISK_WEIGHT_WIND * windNorm + RISK_WEIGHT_OCCUPANCY * occNorm + RISK_WEIGHT_POPULATION * popNorm);
  const rounded = Math.round(raw);
  if (rfzCrossed) return Math.max(rounded, 90);
  return rounded;
}

/** Cell area in km^2 for a square cell of SKYCELL_SIZE_M per side. */
function cellAreaKm2(): number {
  return (SKYCELL_SIZE_M / 1000) * (SKYCELL_SIZE_M / 1000);
}

/**
 * Builds the full skycell lattice for the current tick. Cells are returned
 * row-major; occupancy blends nearby drones (weight by inverse distance) and
 * active mission legs (cells the leg passes through get a boost). Risk is
 * computed from weather, occupancy, and population density. Closed cells are
 * marked from the provided set.
 */
export function buildSkycells(
  drones: Drone[],
  missions: Mission[],
  weatherAlerts: WeatherAlert[] = [],
  closedCells: ClosedCellSet = new Set(),
  rfzPolygons: GeoPoint[][] = [],
): Skycell[] {
  const { latStep, lngStep } = metersPerCell();
  const rows = Math.ceil((HK_BOUNDS.maxLat - HK_BOUNDS.minLat) / latStep);
  const cols = Math.ceil((HK_BOUNDS.maxLng - HK_BOUNDS.minLng) / lngStep);
  const legs = routeLegs(missions);
  const area = cellAreaKm2();

  const cells: Skycell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const south = HK_BOUNDS.minLat + row * latStep;
      const west = HK_BOUNDS.minLng + col * lngStep;
      const center: GeoPoint = { lat: south + latStep / 2, lng: west + lngStep / 2 };
      const cellId = `cell-${row}-${col}`;

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

      const windKph = windAtCell(center, weatherAlerts);
      const temperatureC = temperatureAtCell(center);
      const populationPerKm2 = populationAt(center.lat, center.lng);
      const isClosed = closedCells.has(cellId);

      // Check if any RFZ polygon contains this cell center
      let rfzCrossed = false;
      for (const polygon of rfzPolygons) {
        if (pointInRing(center, polygon)) {
          rfzCrossed = true;
          break;
        }
      }

      const risk = computeRisk(windKph, occupancy, populationPerKm2, isClosed, rfzCrossed);

      cells.push({
        id: cellId,
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
        altitudeBand: 0,
        risk,
        windKph,
        temperatureC,
        areaKm2: area,
        populationPerKm2,
        closed: isClosed,
      });
    }
  }
  return cells;
}

/** Simple point-in-polygon ray cast (for RFZ containment check). */
function pointInRing(point: GeoPoint, ring: GeoPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i].lng, yi = ring[i].lat;
    const xj = ring[j].lng, yj = ring[j].lat;
    const intersect = ((yi > point.lat) !== (yj > point.lat)) &&
      (point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** GeoJSON FeatureCollection for the grid source (fill + line share it). */
export function skycellsToGeoJson(cells: Skycell[]): unknown {
  return {
    type: 'FeatureCollection',
    features: cells.map((cell) => ({
      type: 'Feature',
      id: cell.id,
      properties: {
        id: cell.id,
        occupancy: cell.occupancy,
        band: cell.band,
        risk: cell.risk,
        riskClass: classifyRisk(cell.risk),
        closed: cell.closed,
        windKph: cell.windKph,
        temperatureC: cell.temperatureC,
        areaKm2: cell.areaKm2,
        populationPerKm2: cell.populationPerKm2,
      },
      geometry: { type: 'Polygon', coordinates: [[...cell.ring, cell.ring[0]]] },
    })),
  };
}

/**
 * Finds all skycell IDs whose cell center falls inside any of the given
 * polygons (used by the A* planner to reject routes through closed cells).
 */
export function cellsCrossingPolygons(
  cells: Skycell[],
  polygons: GeoPoint[][],
): Set<string> {
  const result = new Set<string>();
  for (const cell of cells) {
    for (const polygon of polygons) {
      if (pointInRing(cell.center, polygon)) {
        result.add(cell.id);
        break;
      }
    }
  }
  return result;
}
