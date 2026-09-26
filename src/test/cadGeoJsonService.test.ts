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
 * Rings whose vertex centroid legitimately falls outside the ring because the
 * outline is strongly concave (racecourses, firing ranges, border control points,
 * the HK-Zhuhai-Macau bridge corridor). 20 of these 22 already fail the same
 * check against their *unsimplified* rings in the source `map.geojson`, so this
 * is a property of the surveyed geometry, not of ingestion. The remaining two
 * (Marine Police RHQ, Kong Nga Po) are concave shapes whose notch is trimmed by
 * the 48-point budget.
 *
 * The regression guard is the size of this list: the old farthest-point
 * simplifier produced 48 misses out of 135 zones, so reintroducing it fails here.
 */
const CONCAVE_CENTROID_EXCEPTIONS: readonly string[] = [
  "Cape D'Aguilar Radio Stations",
  'China Ferry Terminal Control Point',
  'Ha Tsuen / Deep Bay (Low-altitude Economy Regulatory Sandbox)',
  'Happy Valley Racecourse',
  'Hong Kong - Zhuhai - Macao Bridge Hong Kong Port and Hong Kong Link Road',
  'Hong Kong - Zhuhai - Macao Bridge Hong Kong Port and Hong Kong Link Road',
  'Hong Kong - Zhuhai - Macao Bridge Hong Kong Port and Hong Kong Link Road',
  'Hong Kong Police Mount Butler Firing Range ',
  'Hong Kong Science Park / Tolo Harbour / Ma On Shan (Low-altitude Economy Regulatory Sandbox)',
  'Hong Kong Science Park / Tolo Harbour / Ting Kok (Low-altitude Economy Regulatory Sandbox)',
  'Kong Nga Po Police Training Facilities ',
  'Lei Muk Shue / Shek Lei / Lai Chi Kok (Low-altitude Economy Regulatory Sandbox)',
  'Macau Ferry Terminal Control Point',
  'Marine Police Regional Headquarters and Marine Police Harbour Divisional Headquarters',
  'San Uk Ling Firing Range',
  'Sha Tau Kok Control Point',
  'Sha Tin Racecourse',
  'Sheung Shui / Fanling (Low-altitude Economy Regulatory Sandbox)',
  'Sheung Shui Treatment Works (Low-altitude Economy Regulatory Sandbox)',
  'Smugglers Ridge Firing Range',
  'Ta Kwu Ling Division Border Enforcement Unit Block',
  'Tai O Barracks',
];

/**
 * Deterministic interior point via a horizontal scanline sweep.
 *
 * The sweep walks candidate latitudes across the bounding box, intersects the
 * ring, and returns the midpoint of the first span that really is inside. Unlike
 * the centroid this is always interior for a valid ring, but it is also always
 * satisfiable by a self-intersecting sawtooth, so it is a *validity* check while
 * the centroid test below is the *corruption* check.
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
    // A ring whose vertices still trace the perimeter contains its own centroid
    // unless it is genuinely concave. The old farthest-point simplifier left 48
    // of 135 rings failing this; only the surveyed concave outlines may remain.
    const misses = zones
      .filter((zone) => !pointInPolygon(centroid(zone.polygon), zone.polygon))
      .map((zone) => zone.name)
      .sort();
    expect(misses).toEqual([...CONCAVE_CENTROID_EXCEPTIONS].sort());
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
