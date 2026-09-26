import { describe, expect, it } from 'vitest';
import { loadCadZones, loadCadZonesIntersecting } from '../services/cadGeoJsonService';
import { evaluateZonesAtPoint } from '../services/geo/pointInPolygon';
import { listBackends, resolveBackend } from '../services/dataBackends';

describe('cadGeoJsonService', () => {
  const zones = loadCadZones();

  it('loads 135 unique CAD zones from the ingested GeoJSON pack', () => {
    expect(zones.length).toBe(135);
    const ids = new Set(zones.map((zone) => zone.id));
    expect(ids.size).toBe(zones.length);
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

  it('exposes 135 CAD zones through the adapter while keeping mock state for the rest', () => {
    const cad = resolveBackend('cad-geojson');
    const state = cad.loadInitialState();
    expect(state.zones.length).toBe(135);
    expect(state.drones.length).toBe(4); // fleet still mock replay until M3
    expect(state.wallets.length).toBe(3);

    const mock = resolveBackend('mock');
    expect(mock.loadInitialState().zones.length).toBe(3);
  });

  it('keeps the listZones viewport filter behind the adapter', () => {
    const cad = resolveBackend('cad-geojson');
    const island = cad.listZones({ minLat: 22.24, maxLat: 22.29, minLng: 114.13, maxLng: 114.22 });
    expect(island.length).toBeGreaterThan(0);
    expect(island.length).toBeLessThan(135);
  });
});
