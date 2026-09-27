import type { GeoPoint } from '../types/domain';

/**
 * Shared equirectangular projection for the 2D Hong Kong operating picture
 * (PRD FR-OP-V1). The offline SVG map, the flight-plan route preview and the
 * analytics heatmap all project the same geographic bounds into a 0–100
 * percentage box, so a route drawn in one surface lines up with the others.
 *
 * Bounds match `skycells.ts` `HK_BOUNDS` and the schematic map frame.
 */
export const HK_VIEW_BOUNDS = {
  minLat: 22.255,
  maxLat: 22.37,
  minLng: 114.095,
  maxLng: 114.25,
} as const;

export interface ProjectedPercent {
  x: number;
  y: number;
}

/** Projects a WGS84 point into the 0–100 view box, clamped clear of the frame edge. */
export function projectToPercent(point: GeoPoint): ProjectedPercent {
  const x: number =
    ((point.lng - HK_VIEW_BOUNDS.minLng) / (HK_VIEW_BOUNDS.maxLng - HK_VIEW_BOUNDS.minLng)) * 100;
  const y: number =
    (1 - (point.lat - HK_VIEW_BOUNDS.minLat) / (HK_VIEW_BOUNDS.maxLat - HK_VIEW_BOUNDS.minLat)) * 100;
  return { x: Math.min(96, Math.max(4, x)), y: Math.min(94, Math.max(6, y)) };
}

/** SVG `points` attribute for a WGS84 polyline or polygon ring. */
export function routeToSvgPoints(points: GeoPoint[]): string {
  return points
    .map((point: GeoPoint): string => {
      const projected = projectToPercent(point);
      return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;
    })
    .join(' ');
}

/** Arithmetic mean of a WGS84 ring — used to place wind arrows and labels. */
export function ringCentroid(points: GeoPoint[]): GeoPoint {
  if (points.length === 0) {
    return { lat: (HK_VIEW_BOUNDS.minLat + HK_VIEW_BOUNDS.maxLat) / 2, lng: (HK_VIEW_BOUNDS.minLng + HK_VIEW_BOUNDS.maxLng) / 2 };
  }
  const sum = points.reduce(
    (total: GeoPoint, point: GeoPoint): GeoPoint => ({ lat: total.lat + point.lat, lng: total.lng + point.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}
