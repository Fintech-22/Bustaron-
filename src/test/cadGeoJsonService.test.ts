import { describe, expect, it } from 'vitest';
import { loadCadZones, loadCadZonesIntersecting } from '../services/cadGeoJsonService';
import { evaluateZonesAtPoint, pointInPolygon } from '../services/geo/pointInPolygon';
import { listBackends, resolveBackend } from '../services/dataBackends';
import type { GeoPoint } from '../types/domain';

/** Mean of the ring vertices; the ring is stored closed, so drop the repeat. */
function centroid(polygon: GeoPoint[]): GeoPoint {
  const ring = polygon.length > 1 && polygon[0].lat === polygon[polygon.length - 1].lat
    && polygon[0].lng === polygon[polygon.length - 1].lng
    ? polygon.slice(0, -1)
    : polygon;
  return {
    lat: ring.reduce((sum, p) => sum + p.lat, 0) / ring.length,
    lng: ring.reduce((sum, p) => sum + p.lng, 0) / ring.length,
  };
}

/**
 * Deterministic interior point via a horizontal scanline sweep.
 *
 * A vertex centroid is not usable here: 22 of the 284 CAD rings are concave
 * enough (racecourses, firing ranges, border control points) that their centroid
 * legitimately lies outside the ring — and they already do so in the untouched
 * source `map.geojson`, so it is a property of the geometry, not of ingestion.
 * The sweep walks candidate latitudes across the bounding box, intersects the
 * ring, and returns the midpoint of the first span that really is inside.
 */
function interiorPoint(polygon: GeoPoint[]): GeoPoint | null {
  const ring = polygon.length > 1 && polygon[0].lat === polygon[polygon.length - 1].lat
    && polygon[0].lng === polygon[polygon.length - 1].lng
    ? polygon.slice(0, -1)
    : polygon;
  const lats = ring.map((p) => p.lat);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  for (let step = 1; step < 12; step += 1) {
    const lat = minLat + ((maxLat - minLat) * step) / 12;
    const crossings: number[] = [];
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (a.lat > lat !== b.lat > lat) {
        crossings.push(a.lng + ((lat - a.lat) / (b.lat - a.lat)) * (b.lng - a.lng));
      }
    }
    crossings.sort((x, y) => x - y);
    for (let k = 0; k + 1 < crossings.length; k += 1) {
      const candidate = { lat, lng: (crossings[k] + crossings[k + 1]) / 2 };
      if (pointInPolygon(candidate, polygon)) {
        return candidate;
      }
    }
  }
  return null;
}

describe('cadGeoJsonService', () => {
  const zones = loadCadZones();

  it('loads 284 unique CAD zones from the ingested GeoJSON pack', () => {
    expect(zones.length).toBe(284);
    const ids = new Set(zones.map((zone) => zone.id));
    expect(ids.size).toBe(zones.length);
  });

  it('every CAD zone contains its own interior point', () => {
    for (const zone of loadCadZones()) {
      const probe = interiorPoint(zone.polygon);
      expect(probe, `${zone.name} has no interior point`).not.toBeNull();
      expect(evaluateZonesAtPoint(probe as GeoPoint, [zone]).length).toBe(1);
    }
  });

  it('keeps ring order intact so zones are not self-intersecting sawtooths', () => {
    // 22 of 284 rings are concave enough that the vertex centroid falls outside
    // (they do in the source data too); every other ring must contain it.
    const centroidMisses = zones.filter((zone) => !pointInPolygon(centroid(zone.polygon), zone.polygon));
    expect(centroidMisses.length).toBeLessThanOrEqual(22);
  });

  it('tags every zone as an RFZ with CAD designation metadata', () => {
    for (const zone of zones) {
      expect(zone.kind).toBe('rfz');
      expect(zone.restriction).toMatch(/Designated/);
    }
  });

  it('includes known landmarks such as Tai Mo Shan Peak and Sha Tin Racecourse', () => {
    const names = zones.map((zone) => zone.name);
    expect(names).toContain('Tai Mo Shan Peak');
    expect(names).toContain('Sha Tin Racecourse');
  });

  it('filters zones by viewport bounds', () => {
    // Hong Kong Island window; should exclude the Tai Mo Shan area.
    const islandZones = loadCadZonesIntersecting({ minLat: 22.24, maxLat: 22.29, minLng: 114.13, maxLng: 114.22 });
    expect(islandZones.length).toBeGreaterThan(0);
    expect(islandZones.length).toBeLessThan(zones.length);
    for (const zone of islandZones) {
      expect(zone.polygon.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('supports containment queries over the CAD pack', () => {
    // Interior point of the Tai Mo Shan Peak polygon (verified against the ring).
    const hits = evaluateZonesAtPoint({ lat: 22.4101, lng: 114.1245 }, zones);
    expect(hits.some((hit) => hit.zone.name === 'Tai Mo Shan Peak')).toBe(true);
  });

  it('flags mid-harbour as the Victoria Harbour RFZ and open water as clear', () => {
    // Mid-harbour is a real CAD-designated RFZ in the ingested pack.
    const midHarbour = evaluateZonesAtPoint({ lat: 22.298, lng: 114.165 }, zones);
    expect(midHarbour.some((hit) => hit.zone.name === 'Victoria Harbour')).toBe(true);
    // Open water west of Kennedy Town carries no RFZ.
    const openWater = evaluateZonesAtPoint({ lat: 22.28, lng: 114.1 }, zones);
    expect(openWater).toHaveLength(0);
  });
});

describe('data backend adapters', () => {
  it('defaults to the offline mock replay', () => {
    const backend = resolveBackend(undefined);
    expect(backend.id).toBe('mock');
    expect(backend.offlineCapable).toBe(true);
  });

  it('lists both backends and resolves the CAD one by id', () => {
    const backends = listBackends();
    expect(backends.map((entry) => entry.id)).toEqual(['mock', 'cad-geojson']);
    const cad = resolveBackend('cad-geojson');
    expect(cad.id).toBe('cad-geojson');
    expect(cad.usesIngestedGeodata).toBe(true);
  });

  it('falls back to mock for unknown ids', () => {
    expect(resolveBackend('nonsense').id).toBe('mock');
  });

  it('exposes 284 CAD zones through the adapter while keeping mock state for the rest', () => {
    const cad = resolveBackend('cad-geojson');
    const state = cad.loadInitialState();
    expect(state.zones.length).toBe(284);
    expect(state.drones.length).toBe(4); // fleet still mock replay until M3
    expect(state.wallets.length).toBe(3);

    const mock = resolveBackend('mock');
    expect(mock.loadInitialState().zones.length).toBe(3);
  });

  it('keeps the listZones viewport filter behind the adapter', () => {
    const cad = resolveBackend('cad-geojson');
    const island = cad.listZones({ minLat: 22.24, maxLat: 22.29, minLng: 114.13, maxLng: 114.22 });
    expect(island.length).toBeGreaterThan(0);
    expect(island.length).toBeLessThan(284);
  });
});
