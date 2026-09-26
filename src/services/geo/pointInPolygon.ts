import type { AirspaceZone } from '../../types/domain';

export interface LatLngVertex {
  /** Planar x coordinate in metres (equirectangular, centred on Hong Kong). */
  x: number;
  /** Planar y coordinate in metres (equirectangular, centred on Hong Kong). */
  y: number;
}

/** Hong Kong centroid used for the local equirectangular projection. */
export const HK_CENTRE: { lat: number; lng: number } = { lat: 22.3, lng: 114.17 };

const EARTH_RADIUS_M = 6371000;
const DEG_TO_RAD = Math.PI / 180;

/** Converts WGS84 degrees to planar metres via a local equirectangular projection. */
export function toPlanar(point: { lat: number; lng: number }): LatLngVertex {
  return {
    x: point.lng * DEG_TO_RAD * EARTH_RADIUS_M * Math.cos(HK_CENTRE.lat * DEG_TO_RAD),
    y: point.lat * DEG_TO_RAD * EARTH_RADIUS_M,
  };
}

/** Converts planar metres back to WGS84 degrees. */
export function toLatLng(vertex: LatLngVertex): { lat: number; lng: number } {
  return {
    lng: vertex.x / (DEG_TO_RAD * EARTH_RADIUS_M * Math.cos(HK_CENTRE.lat * DEG_TO_RAD)),
    lat: vertex.y / (DEG_TO_RAD * EARTH_RADIUS_M),
  };
}

/** Great-circle distance between two WGS84 points using the haversine formula, in metres. */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const latMean = (a.lat + b.lat) * 0.5 * DEG_TO_RAD;
  const aHav = Math.sin(dLat / 2) ** 2 + Math.cos(latMean) ** 2 * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(aHav)));
}

/** Euclidean distance between two planar vertices, in metres. */
export function planarDistanceM(a: LatLngVertex, b: LatLngVertex): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Closest squared distance from p to segment ab. */
function segmentDistanceSq(p: LatLngVertex, a: LatLngVertex, b: LatLngVertex): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq === 0) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    return dx * dx + dy * dy;
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return dx * dx + dy * dy;
}

/** Minimum distance in metres from a point to a planar ring or polyline. */
export function pointToRingDistanceM(point: LatLngVertex, ring: LatLngVertex[]): number {
  let minSq = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length - 1; i += 1) {
    minSq = Math.min(minSq, segmentDistanceSq(point, ring[i], ring[i + 1]));
  }
  return Math.sqrt(minSq);
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Inclusive bounding box for a polygon given in WGS84 degrees. */
export function polygonBounds(polygon: { lat: number; lng: number }[]): BoundingBox {
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  for (const point of polygon) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  }
  return { minLat, maxLat, minLng, maxLng };
}

/** Cheap rectangular pre-filter before the exact point-in-polygon test. */
export function boundsContain(bounds: BoundingBox, point: { lat: number; lng: number }): boolean {
  return (
    point.lat >= bounds.minLat &&
    point.lat <= bounds.maxLat &&
    point.lng >= bounds.minLng &&
    point.lng <= bounds.maxLng
  );
}

/**
 * Ray-casting point-in-polygon test on WGS84 degrees. Hong Kong spans well under
 * one degree, so treating longitude/latitude as planar is accurate enough for
 * airspace containment checks at this scale. Handles concave rings and is safe
 * for degenerate inputs (fewer than 3 distinct vertices).
 */
export function pointInPolygon(point: { lat: number; lng: number }, polygon: { lat: number; lng: number }[]): boolean {
  if (polygon.length < 3) {
    return false;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects =
      pi.lng > point.lng !== pj.lng > point.lng &&
      point.lat < ((pj.lat - pi.lat) * (point.lng - pi.lng)) / (pj.lng - pi.lng) + pi.lat;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

export interface ZoneHit {
  zone: AirspaceZone;
  /** Distance in metres from the point to the zone polygon (0 when inside). */
  distanceM: number;
}

/**
 * Evaluates a WGS84 point against zones: returns every zone whose polygon
 * contains the point (distance 0) or lies within `bufferM` of it.
 */
export function evaluateZonesAtPoint(
  point: { lat: number; lng: number },
  zones: AirspaceZone[],
  bufferM = 0,
): ZoneHit[] {
  const hits: ZoneHit[] = [];
  // Padding so the cheap bbox pre-filter cannot reject a point that is outside
  // the polygon but inside the requested buffer.
  const latPad = bufferM / 111320;
  const lngPad = bufferM / (111320 * Math.cos(22.3 * (Math.PI / 180)));
  for (const zone of zones) {
    const bounds = polygonBounds(zone.polygon);
    const padded = {
      minLat: bounds.minLat - latPad,
      maxLat: bounds.maxLat + latPad,
      minLng: bounds.minLng - lngPad,
      maxLng: bounds.maxLng + lngPad,
    };
    if (!boundsContain(padded, point)) {
      continue;
    }
    if (pointInPolygon(point, zone.polygon)) {
      hits.push({ zone, distanceM: 0 });
      continue;
    }
    if (bufferM > 0) {
      const ring = zone.polygon.map(toPlanar);
      const distanceM = pointToRingDistanceM(toPlanar(point), ring);
      if (distanceM <= bufferM) {
        hits.push({ zone, distanceM: Math.round(distanceM) });
      }
    }
  }
  return hits;
}
