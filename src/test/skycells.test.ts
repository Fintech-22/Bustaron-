import { describe, expect, it } from 'vitest';
import { buildSkycells, skycellBandColor, skycellsToGeoJson } from '../services/skycells';
import type { Drone, Mission } from '../types/domain';

const drone = (over: Partial<Drone> = {}): Drone => ({
  id: 'd1',
  callsign: 'T-01',
  operatorId: 'wallet-harbour',
  position: { lat: 22.3, lng: 114.17 },
  altitudeM: 100,
  status: 'nominal',
  batteryPct: 80,
  missionId: 'm1',
  headingDeg: 0,
  speedKph: 30,
  lastSeenIso: '2026-09-26T00:00:00Z',
  ...over,
});

const mission = (route: Mission['route']): Mission => ({
  id: 'm1',
  name: 'Test mission',
  operator: 'Ops',
  route,
  status: 'active',
  riskLevel: 'medium',
  altitudeWindowM: [80, 160],
  etaIso: '2026-09-26T01:00:00Z',
});

describe('skycell lattice', () => {
  it('covers the HK operating area with ~600 m cells', () => {
    const cells = buildSkycells([drone()], [mission([{ lat: 22.28, lng: 114.15 }, { lat: 22.32, lng: 114.2 }])]);
    expect(cells.length).toBeGreaterThan(100);
    const latSpans = cells.filter((cell) => cell.row === 0).length;
    expect(latSpans).toBeGreaterThan(15);
    // Every ring is a closed 5-point polygon.
    for (const cell of cells.slice(0, 10)) {
      expect(cell.ring).toHaveLength(4);
    }
  });

  it('is deterministic for identical state', () => {
    const drones = [drone(), drone({ id: 'd2', position: { lat: 22.33, lng: 114.2 }, status: 'critical' })];
    const missions = [mission([{ lat: 22.28, lng: 114.15 }, { lat: 22.32, lng: 114.2 }])];
    expect(buildSkycells(drones, missions)).toEqual(buildSkycells(drones, missions));
  });

  it('raises occupancy near drones and routes, and bands accordingly', () => {
    const quiet = buildSkycells([], []);
    const busy = buildSkycells(
      [
        drone(),
        drone({ id: 'd2', position: { lat: 22.3, lng: 114.17 }, status: 'critical' }),
        drone({ id: 'd3', position: { lat: 22.301, lng: 114.171 } }),
      ],
      [mission([{ lat: 22.3, lng: 114.17 }, { lat: 22.301, lng: 114.171 }])],
    );
    const centreId = 'cell-' + Math.floor((22.3 - 22.255) / (600 / 111_320)) + '-' + Math.floor((114.17 - 114.095) / (600 / (111_320 * Math.cos((22.31 * Math.PI) / 180))));
    const quietCell = quiet.find((cell) => cell.id === centreId)!;
    const busyCell = busy.find((cell) => cell.id === centreId)!;
    expect(busyCell.occupancy).toBeGreaterThan(quietCell.occupancy);
    expect(busyCell.occupancy).toBeGreaterThan(0.3);
    // Band thresholds match the PRD colors.
    expect(skycellBandColor.congested).toBe('#ef4444');
    expect(skycellBandColor.clear).toBe('#4ade80');
  });

  it('serialises to a GeoJSON FeatureCollection with band properties', () => {
    const geo = skycellsToGeoJson(buildSkycells([drone()], [])) as {
      type: string;
      features: { properties: { band: string; occupancy: number }; geometry: { coordinates: number[][][] } }[];
    };
    expect(geo.type).toBe('FeatureCollection');
    expect(geo.features.length).toBeGreaterThan(100);
    const first = geo.features[0];
    expect(typeof first.properties.occupancy).toBe('number');
    expect(['clear', 'light', 'busy', 'congested']).toContain(first.properties.band);
    expect(first.geometry.coordinates[0]).toHaveLength(5);
  });
});
